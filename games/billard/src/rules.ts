import { otherSeat, type GameDefinition, type GameResult, type MoveCheck, type Seat } from "@spielhalle/core";
import { cloneBalls, simulateShot, type Ball, type PhysicsEvent, type Shot } from "./physics";
import { rack8Ball } from "./rack";
import { FOOT_SPOT, HEAD_SPOT, TABLE, vec, type Vec } from "./table";

/**
 * 8-Ball nach vereinfachten Pool-Regeln:
 * offener Tisch bis zur ersten versenkten Kugel nach dem Anstoß, Volle (1–7) gegen Halbe (9–15),
 * die 8 zuletzt. Ein Foul gibt dem Gegner "Kugel in der Hand".
 */

export type Group = "solids" | "stripes";

export type BillardState = {
  balls: Ball[];
  turn: Seat;
  groups: [Group | null, Group | null];
  /** Der Spieler am Zug darf die weiße Kugel frei setzen. */
  ballInHand: boolean;
  /** Nächster Stoß ist der Anstoß (weiße Kugel nur hinter der Kopflinie). */
  isBreak: boolean;
  winner: Seat | null;
  winReason: string | null;
  shots: number;
};

export type BillardMove = {
  shot: Shot;
  /** Pflicht bei "Kugel in der Hand": wohin die weiße Kugel gesetzt wird. */
  cueBallPos?: Vec;
};

export type FoulReason = "weiße versenkt" | "keine Kugel getroffen" | "falsche Kugel zuerst" | "keine Bande nach dem Treffer";

export type BillardEvent =
  | { kind: "potted"; ball: number; seat: Seat }
  | { kind: "groupsAssigned"; seat: Seat; group: Group }
  | { kind: "foul"; seat: Seat; reason: FoulReason }
  | { kind: "eightRespotted" }
  | { kind: "turn"; seat: Seat }
  | { kind: "won"; seat: Seat; reason: string };

export const groupOf = (id: number): Group | null => (id >= 1 && id <= 7 ? "solids" : id >= 9 && id <= 15 ? "stripes" : null);

export function groupCleared(balls: readonly Ball[], group: Group) {
  return balls.every((b) => groupOf(b.id) !== group || b.potted);
}

export function createInitialState(options: { seed: number; startingSeat: Seat }): BillardState {
  return {
    balls: rack8Ball(options.seed),
    turn: options.startingSeat,
    groups: [null, null],
    ballInHand: true,
    isBreak: true,
    winner: null,
    winReason: null,
    shots: 0
  };
}

/** Darf die weiße Kugel hier liegen? */
export function isValidCuePlacement(state: BillardState, pos: Vec): boolean {
  const r = TABLE.ballRadius;
  if (pos.x < r || pos.y < r || pos.x > TABLE.width - r || pos.y > TABLE.height - r) return false;
  if (state.isBreak && pos.x > TABLE.headStringX) return false;
  return state.balls.every((b) => b.id === 0 || b.potted || vec.dist(b.pos, pos) >= 2 * r);
}

export function checkMove(state: BillardState, seat: Seat, move: BillardMove): MoveCheck {
  if (state.winner !== null) return { ok: false, reason: "Die Partie ist vorbei" };
  if (seat !== state.turn) return { ok: false, reason: "Nicht am Zug" };
  const { angle, power, spin } = move.shot;
  if (![angle, power, spin.x, spin.y].every(Number.isFinite)) return { ok: false, reason: "Ungültiger Stoß" };
  if (power <= 0 || power > 1) return { ok: false, reason: "Stoßstärke muss zwischen 0 und 1 liegen" };
  if (Math.hypot(spin.x, spin.y) > 1.0001) return { ok: false, reason: "Effet außerhalb der Kugel" };
  if (move.cueBallPos) {
    if (!state.ballInHand) return { ok: false, reason: "Weiße Kugel darf nicht versetzt werden" };
    if (!isValidCuePlacement(state, move.cueBallPos)) return { ok: false, reason: "Weiße Kugel kann dort nicht liegen" };
  }
  return { ok: true };
}

/** Wendet einen Stoß an: simuliert ihn und wertet danach die Regeln aus. */
export function applyMove(state: BillardState, seat: Seat, move: BillardMove): { state: BillardState; events: BillardEvent[] } {
  const check = checkMove(state, seat, move);
  if (!check.ok) throw new Error(check.reason);
  const balls = cloneBalls(state.balls);
  if (move.cueBallPos) {
    const cue = balls.find((b) => b.id === 0)!;
    cue.pos = { ...move.cueBallPos };
    cue.potted = false;
  }
  const sim = simulateShot(balls, move.shot);
  return judgeShot({ ...state, balls }, seat, sim.balls, sim.events);
}

/**
 * Bewertet einen fertig simulierten Stoß. `before` ist der Zustand direkt vor dem Stoß
 * (weiße Kugel schon gesetzt), `after` die Kugeln nach dem Stillstand.
 */
export function judgeShot(
  before: BillardState,
  seat: Seat,
  after: Ball[],
  physics: readonly PhysicsEvent[]
): { state: BillardState; events: BillardEvent[] } {
  const events: BillardEvent[] = [];
  const opponent = otherSeat(seat);
  const balls = cloneBalls(after);
  const groups: [Group | null, Group | null] = [before.groups[0], before.groups[1]];
  const ownGroup = groups[seat];
  const onEight = ownGroup !== null && groupCleared(before.balls, ownGroup);

  const firstContactIndex = physics.findIndex((e) => e.kind === "ballContact" && (e.a === 0 || e.b === 0));
  const firstContactEvent = physics[firstContactIndex];
  const firstContact =
    firstContactEvent && firstContactEvent.kind === "ballContact" ? (firstContactEvent.a === 0 ? firstContactEvent.b : firstContactEvent.a) : null;
  const potted = physics.flatMap((e) => (e.kind === "pocket" ? [e.ball] : []));
  const pottedObjects = potted.filter((id) => id !== 0);
  const railAfterContact =
    firstContactIndex >= 0 && physics.slice(firstContactIndex + 1).some((e) => e.kind === "cushion" || e.kind === "pocket");

  for (const id of pottedObjects) events.push({ kind: "potted", ball: id, seat });

  let foul: FoulReason | null = null;
  if (potted.includes(0)) foul = "weiße versenkt";
  else if (firstContact === null) foul = "keine Kugel getroffen";
  else if (!before.isBreak && !isLegalFirstContact(firstContact, ownGroup, onEight)) foul = "falsche Kugel zuerst";
  else if (!before.isBreak && !railAfterContact) foul = "keine Bande nach dem Treffer";

  let winner: Seat | null = null;
  let winReason: string | null = null;

  if (pottedObjects.includes(8)) {
    if (before.isBreak) {
      respotEight(balls);
      events.push({ kind: "eightRespotted" });
    } else if (onEight && foul === null) {
      winner = seat;
      winReason = "8 regulär versenkt";
    } else {
      winner = opponent;
      winReason = foul ? "8 mit Foul versenkt" : "8 zu früh versenkt";
    }
  }

  if (winner === null && foul === null && ownGroup === null && !before.isBreak) {
    const firstGroup = pottedObjects.map(groupOf).find((g): g is Group => g !== null);
    if (firstGroup) {
      groups[seat] = firstGroup;
      groups[opponent] = firstGroup === "solids" ? "stripes" : "solids";
      events.push({ kind: "groupsAssigned", seat, group: firstGroup });
    }
  }

  const cue = balls.find((b) => b.id === 0)!;
  if (cue.potted) {
    cue.potted = false;
    cue.pos = { ...HEAD_SPOT };
  }

  if (foul) events.push({ kind: "foul", seat, reason: foul });

  const groupNow = groups[seat];
  const scored = before.isBreak || groupNow === null
    ? pottedObjects.some((id) => id !== 8)
    : pottedObjects.some((id) => groupOf(id) === groupNow);
  const keepsTurn = winner === null && foul === null && scored;
  const turn = winner !== null ? seat : keepsTurn ? seat : opponent;

  if (winner !== null) events.push({ kind: "won", seat: winner, reason: winReason! });
  else events.push({ kind: "turn", seat: turn });

  return {
    state: {
      balls,
      turn,
      groups,
      ballInHand: foul !== null && winner === null,
      isBreak: false,
      winner,
      winReason,
      shots: before.shots + 1
    },
    events
  };
}

function isLegalFirstContact(id: number, ownGroup: Group | null, onEight: boolean) {
  if (ownGroup === null) return id !== 8;
  if (onEight) return id === 8;
  return groupOf(id) === ownGroup;
}

/** Setzt die 8 auf den Fußpunkt zurück, notfalls ein Stück weiter Richtung Fußbande. */
function respotEight(balls: Ball[]) {
  const eight = balls.find((b) => b.id === 8)!;
  const r = TABLE.ballRadius;
  for (let x = FOOT_SPOT.x; x < TABLE.width - r; x += 2) {
    const pos = { x, y: FOOT_SPOT.y };
    if (balls.every((b) => b.id === 8 || b.potted || vec.dist(b.pos, pos) >= 2 * r)) {
      eight.pos = pos;
      eight.potted = false;
      return;
    }
  }
  eight.pos = { ...FOOT_SPOT };
  eight.potted = false;
}

export function result(state: BillardState): GameResult {
  return state.winner === null ? { kind: "running" } : { kind: "won", winner: state.winner, reason: state.winReason ?? "" };
}

export const billard: GameDefinition<BillardState, BillardMove, BillardEvent> = {
  id: "billard",
  name: "Billard (8-Ball)",
  players: 2,
  createInitialState,
  currentSeat: (state) => state.turn,
  checkMove,
  applyMove,
  result
};
