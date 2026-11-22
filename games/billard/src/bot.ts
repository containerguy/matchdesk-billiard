import { otherSeat, type Seat } from "@bandenduell/core";
import { cloneBalls, simulateShot, type Ball } from "./physics";
import { random } from "./rack";
import { groupCleared, groupOf, isValidCuePlacement, judgeShot, type BillardMove, type BillardState } from "./rules";
import { FOOT_SPOT, POCKETS, TABLE, vec, type Vec } from "./table";

/** Spielstärke des Computergegners. */
export type BotLevel = "easy" | "medium" | "hard";

type LevelConfig = {
  /** So viele geometrisch beste Kandidaten werden durchgerechnet. */
  candidates: number;
  powers: readonly number[];
  /** Standardabweichung des Zielfehlers in Grad. */
  angleNoiseDeg: number;
  powerNoise: number;
  /** Positionen, die mit "Kugel in der Hand" geprüft werden. */
  placements: number;
  /** Berücksichtigt, wie die Weiße danach liegt. */
  position: boolean;
  /** Wahrscheinlichkeit, statt des besten einen der nächstbesten Stöße zu nehmen. */
  blunder: number;
};

const LEVELS: Record<BotLevel, LevelConfig> = {
  easy: { candidates: 3, powers: [0.5], angleNoiseDeg: 1.5, powerNoise: 0.12, placements: 2, position: false, blunder: 0.35 },
  medium: { candidates: 8, powers: [0.4, 0.65], angleNoiseDeg: 0.5, powerNoise: 0.06, placements: 5, position: false, blunder: 0.1 },
  hard: { candidates: 12, powers: [0.32, 0.5, 0.72], angleNoiseDeg: 0.1, powerNoise: 0.02, placements: 10, position: true, blunder: 0 }
};

const MAX_CUT = (72 * Math.PI) / 180;

type Candidate = { move: BillardMove; geometry: number };

/**
 * Wählt den Stoß des Computergegners. Reine Funktion: gleicher Zustand, gleiche Stufe
 * und gleicher Seed ergeben denselben Stoß.
 */
export function chooseBotMove(state: BillardState, seat: Seat, level: BotLevel, seed: number): BillardMove {
  const cfg = LEVELS[level];
  const rnd = random(seed);
  if (state.isBreak) return breakShot(cfg, rnd);

  const candidates = potCandidates(state, seat, cfg);
  const scored = candidates
    .flatMap((c) => cfg.powers.map((power) => ({ ...c.move, shot: { ...c.move.shot, power } })))
    .map((move) => ({ move, score: evaluate(state, seat, move, cfg) }));

  // Kein brauchbarer Lochversuch: rundum probieren und wenigstens ein Foul vermeiden
  if (!scored.some((s) => s.score > 0)) {
    for (const move of fallbackMoves(state, seat)) scored.push({ move, score: evaluate(state, seat, move, cfg) });
  }
  scored.sort((a, b) => b.score - a.score);
  const pickFrom = scored.filter((s) => s.score > -150).slice(0, 3);
  const chosen = pickFrom.length > 1 && rnd() < cfg.blunder ? pickFrom[1 + Math.floor(rnd() * (pickFrom.length - 1))]! : scored[0]!;
  return withNoise(chosen.move, cfg, rnd);
}

function breakShot(cfg: LevelConfig, rnd: () => number): BillardMove {
  const cueBallPos = { x: TABLE.headStringX - 60, y: TABLE.height / 2 + (rnd() - 0.5) * 240 };
  const angle = Math.atan2(FOOT_SPOT.y - cueBallPos.y, FOOT_SPOT.x - cueBallPos.x);
  // Kräftig genug für einen gültigen Anstoß, auch nach der Streuung der Stufe
  const move = withNoise({ shot: { angle, power: 0.95, spin: { x: 0, y: 0 } }, cueBallPos }, cfg, rnd);
  return { ...move, shot: { ...move.shot, power: Math.max(0.85, move.shot.power) } };
}

/** Kugeln, die der Spieler als erste treffen darf. */
function legalTargets(state: BillardState, seat: Seat): Ball[] {
  const own = state.groups[seat];
  const live = state.balls.filter((b) => b.id !== 0 && !b.potted);
  // Aus dem Kopffeld heraus dürfen Kugeln im Kopffeld nicht direkt angespielt werden
  const reachable = state.fromKitchen ? live.filter((b) => b.pos.x >= TABLE.headStringX) : live;
  if (own === null) return reachable.filter((b) => b.id !== 8);
  if (groupCleared(state.balls, own)) return reachable.filter((b) => b.id === 8);
  return reachable.filter((b) => groupOf(b.id) === own);
}

/** Ist der Weg von a nach b frei von anderen Kugeln (außer den genannten)? */
function pathClear(balls: readonly Ball[], a: Vec, b: Vec, ignore: readonly number[]) {
  const d = vec.sub(b, a);
  const len = vec.len(d);
  if (len === 0) return true;
  const n = vec.scale(d, 1 / len);
  const limit = 2 * TABLE.ballRadius - 1;
  for (const ball of balls) {
    if (ball.potted || ignore.includes(ball.id)) continue;
    const rel = vec.sub(ball.pos, a);
    const t = vec.dot(rel, n);
    if (t <= 0 || t >= len) continue;
    if (Math.abs(rel.x * n.y - rel.y * n.x) < limit) return false;
  }
  return true;
}

/** Punkt, auf den eine Kugel zielen muss, um in die Tasche zu fallen (etwas vor der Taschenmitte). */
function pocketAim(pocket: Vec): Vec {
  const center = { x: TABLE.width / 2, y: TABLE.height / 2 };
  return vec.add(pocket, vec.scale(vec.norm(vec.sub(center, pocket)), 30));
}

/** Geometrisch mögliche Lochversuche, beste zuerst. */
function potCandidates(state: BillardState, seat: Seat, cfg: LevelConfig): Candidate[] {
  const targets = legalTargets(state, seat);
  const cue = state.balls.find((b) => b.id === 0)!;
  const r = TABLE.ballRadius;
  const out: Candidate[] = [];

  for (const target of targets) {
    for (const pocket of POCKETS) {
      const aim = pocketAim(pocket);
      const toPocket = vec.sub(aim, target.pos);
      const pocketDist = vec.len(toPocket);
      const dir = vec.scale(toPocket, 1 / pocketDist);
      const ghost = vec.sub(target.pos, vec.scale(dir, 2 * r));
      if (!pathClear(state.balls, target.pos, aim, [0, target.id])) continue;

      const cuePositions: Array<Vec | undefined> = state.ballInHand ? placementsBehind(state, ghost, dir, cfg) : [undefined];
      for (const cueBallPos of cuePositions) {
        const from = cueBallPos ?? cue.pos;
        const toGhost = vec.sub(ghost, from);
        const cueDist = vec.len(toGhost);
        if (cueDist < 1) continue;
        const cut = Math.acos(Math.min(1, Math.max(-1, vec.dot(vec.scale(toGhost, 1 / cueDist), dir))));
        if (cut > MAX_CUT) continue;
        if (!pathClear(state.balls, from, ghost, [0, target.id])) continue;
        const geometry = Math.cos(cut) ** 2 / (1 + (cueDist + 1.5 * pocketDist) / 1500);
        const move: BillardMove = { shot: { angle: Math.atan2(toGhost.y, toGhost.x), power: 0.5, spin: { x: 0, y: 0 } } };
        if (cueBallPos) move.cueBallPos = cueBallPos;
        out.push({ move, geometry });
      }
    }
  }
  out.sort((a, b) => b.geometry - a.geometry);
  return out.slice(0, cfg.candidates);
}

/** Gültige Positionen für die Weiße in gerader Linie hinter der Geisterkugel. */
function placementsBehind(state: BillardState, ghost: Vec, dir: Vec, cfg: LevelConfig): Vec[] {
  const out: Vec[] = [];
  for (const distance of [260, 420, 160, 600]) {
    const pos = vec.sub(ghost, vec.scale(dir, distance));
    if (isValidCuePlacement(state, pos)) out.push(pos);
    if (out.length >= Math.max(1, Math.ceil(cfg.placements / 4))) break;
  }
  return out;
}

/** Notlösung ohne Lochchance: direkt auf erlaubte Kugeln und rundum in festen Winkeln. */
function fallbackMoves(state: BillardState, seat: Seat): BillardMove[] {
  const moves: BillardMove[] = [];
  let cueBallPos: Vec | undefined;
  let from = state.balls.find((b) => b.id === 0)!.pos;
  if (state.ballInHand) {
    cueBallPos = [{ x: TABLE.width / 2, y: TABLE.height / 2 }, { x: 400, y: 300 }, { x: 1800, y: 800 }, { x: 400, y: 800 }, { x: 1800, y: 300 }, { x: 300, y: 560 }, { x: 150, y: 200 }].find((p) =>
      isValidCuePlacement(state, p)
    );
    if (cueBallPos) from = cueBallPos;
  }
  const add = (angle: number, power: number) => {
    const move: BillardMove = { shot: { angle, power, spin: { x: 0, y: 0 } } };
    if (cueBallPos) move.cueBallPos = cueBallPos;
    moves.push(move);
  };
  for (const target of legalTargets(state, seat)) add(Math.atan2(target.pos.y - from.y, target.pos.x - from.x), 0.45);
  for (let i = 0; i < 24; i++) add((i / 24) * Math.PI * 2, 0.5);
  return moves;
}

/** Rechnet einen Stoß durch und bewertet das Ergebnis aus Sicht von `seat`. */
function evaluate(state: BillardState, seat: Seat, move: BillardMove, cfg: LevelConfig): number {
  const balls = cloneBalls(state.balls);
  if (move.cueBallPos) {
    const cue = balls.find((b) => b.id === 0)!;
    cue.pos = { ...move.cueBallPos };
    cue.potted = false;
  }
  const sim = simulateShot(balls, move.shot);
  const { state: after, events } = judgeShot({ ...state, balls }, seat, sim.balls, sim.events);
  if (after.winner === seat) return 1000;
  if (after.winner !== null) return -1000;
  if (events.some((e) => e.kind === "foul")) return -200;
  const potted = events.filter((e) => e.kind === "potted").length;
  if (after.turn === seat) {
    let score = 100 + 20 * potted;
    if (cfg.position) score += 40 * bestGeometry(after, seat);
    return score;
  }
  let score = -10;
  if (cfg.position) score -= 30 * bestGeometry(after, otherSeat(seat));
  return score;
}

/** Wie gut ist die beste Lochchance in dieser Stellung (0 = keine)? */
function bestGeometry(state: BillardState, seat: Seat): number {
  return potCandidates({ ...state, ballInHand: false }, seat, { ...LEVELS.easy, candidates: 1 })[0]?.geometry ?? 0;
}

function withNoise(move: BillardMove, cfg: LevelConfig, rnd: () => number): BillardMove {
  // Summe aus drei Gleichverteilungen: annähernd normalverteilt mit Standardabweichung 1
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;
  const angle = move.shot.angle + (gauss() * cfg.angleNoiseDeg * Math.PI) / 180;
  const power = Math.min(1, Math.max(0.15, move.shot.power + gauss() * cfg.powerNoise));
  return { ...move, shot: { ...move.shot, angle, power } };
}
