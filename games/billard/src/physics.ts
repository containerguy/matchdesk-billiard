import { POCKETS, TABLE, vec, type Vec } from "./table";

/**
 * Deterministische 2D-Kugelphysik mit festem Zeitschritt.
 *
 * Bewusst einfach gehalten: Gleit- und Rollreibung als eine Bremskraft, elastische
 * Kugelstöße, gedämpfte Banden. Effet wirkt vereinfacht: Vor- und Rücklauf ändern die
 * weiße Kugel nach dem ersten Treffer, seitliches Effet verändert den Abprall an der Bande.
 */

export const STEP_SECONDS = 1 / 480;
/** Höchstgeschwindigkeit eines Stoßes in mm/s (Stärke 1). */
export const MAX_SHOT_SPEED = 7000;

const FRICTION_CONSTANT = 260; // mm/s²
const FRICTION_LINEAR = 0.32; // 1/s
const STOP_SPEED = 6; // mm/s
const BALL_RESTITUTION = 0.94;
const CUSHION_RESTITUTION = 0.72;
const FOLLOW_DRAW_FACTOR = 0.55;
const SIDE_SPIN_FACTOR = 0.25;
const MAX_STEPS = 480 * 40; // Sicherheitsgrenze: 40 Sekunden

export type Ball = {
  /** 0 = weiße Kugel, 1–15 = Objektkugeln. */
  id: number;
  pos: Vec;
  vel: Vec;
  potted: boolean;
};

export type Shot = {
  /** Stoßrichtung in Radiant (0 = nach rechts). */
  angle: number;
  /** Stoßstärke 0..1. */
  power: number;
  /** Treffpunkt auf der weißen Kugel, je -1..1: x seitlich, y < 0 Vorlauf, y > 0 Rücklauf. */
  spin: Vec;
};

export type PhysicsEvent =
  | { kind: "ballContact"; a: number; b: number }
  | { kind: "cushion"; ball: number; pos: Vec }
  | { kind: "pocket"; ball: number; pocket: number };

export type Simulation = {
  balls: Ball[];
  events: PhysicsEvent[];
  steps: number;
  done: boolean;
};

type SpinState = { follow: number; side: number; applied: boolean; shotDir: Vec };

export function cloneBalls(balls: readonly Ball[]): Ball[] {
  return balls.map((b) => ({ id: b.id, pos: { ...b.pos }, vel: { ...b.vel }, potted: b.potted }));
}

/** Startet die Simulation eines Stoßes. Die übergebenen Kugeln bleiben unverändert. */
export function startShot(balls: readonly Ball[], shot: Shot): Simulation & { spin: SpinState } {
  const next = cloneBalls(balls);
  const cue = next.find((b) => b.id === 0);
  if (!cue || cue.potted) throw new Error("Weiße Kugel ist nicht auf dem Tisch");
  const dir = vec.fromAngle(shot.angle);
  const power = clamp(shot.power, 0, 1);
  cue.vel = vec.scale(dir, power * MAX_SHOT_SPEED);
  return {
    balls: next,
    events: [],
    steps: 0,
    done: power === 0,
    spin: {
      follow: -clamp(shot.spin.y, -1, 1),
      side: clamp(shot.spin.x, -1, 1),
      applied: false,
      shotDir: dir
    }
  };
}

/** Rückt die Simulation um `count` Zeitschritte vor. Gibt `true` zurück, wenn alle Kugeln ruhen. */
export function advance(sim: Simulation & { spin: SpinState }, count: number): boolean {
  for (let i = 0; i < count && !sim.done; i++) {
    step(sim);
    sim.steps++;
    if (sim.steps >= MAX_STEPS || sim.balls.every((b) => b.potted || (b.vel.x === 0 && b.vel.y === 0))) {
      for (const b of sim.balls) b.vel = { x: 0, y: 0 };
      sim.done = true;
    }
  }
  return sim.done;
}

/** Simuliert einen Stoß komplett bis zum Stillstand. */
export function simulateShot(balls: readonly Ball[], shot: Shot): Simulation {
  const sim = startShot(balls, shot);
  advance(sim, MAX_STEPS);
  return { balls: sim.balls, events: sim.events, steps: sim.steps, done: sim.done };
}

function step(sim: Simulation & { spin: SpinState }) {
  const dt = STEP_SECONDS;
  const r = TABLE.ballRadius;
  const active = sim.balls.filter((b) => !b.potted);

  // Bewegen und bremsen
  for (const b of active) {
    const speed = vec.len(b.vel);
    if (speed === 0) continue;
    const decel = (FRICTION_CONSTANT + FRICTION_LINEAR * speed) * dt;
    const newSpeed = speed - decel;
    if (newSpeed <= STOP_SPEED) {
      b.vel = { x: 0, y: 0 };
    } else {
      b.vel = vec.scale(b.vel, newSpeed / speed);
    }
    b.pos = vec.add(b.pos, vec.scale(b.vel, dt));
  }

  // Kugel gegen Kugel
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const d = vec.sub(b.pos, a.pos);
      const dist = vec.len(d);
      if (dist >= 2 * r || dist === 0) continue;
      const n = vec.scale(d, 1 / dist);
      // Überlappung je zur Hälfte auflösen
      const overlap = 2 * r - dist;
      a.pos = vec.sub(a.pos, vec.scale(n, overlap / 2));
      b.pos = vec.add(b.pos, vec.scale(n, overlap / 2));
      const rel = vec.dot(vec.sub(a.vel, b.vel), n);
      if (rel <= 0) continue;
      const impulse = ((1 + BALL_RESTITUTION) / 2) * rel;
      a.vel = vec.sub(a.vel, vec.scale(n, impulse));
      b.vel = vec.add(b.vel, vec.scale(n, impulse));
      sim.events.push({ kind: "ballContact", a: a.id, b: b.id });
      if ((a.id === 0 || b.id === 0) && !sim.spin.applied) {
        applyFollowDraw(a.id === 0 ? a : b, rel, sim.spin);
      }
    }
  }

  // Taschen und Banden
  for (const b of active) {
    const pocket = POCKETS.findIndex((p) => vec.dist(p, b.pos) < TABLE.pocketRadius);
    if (pocket >= 0 || isOffTable(b.pos)) {
      b.potted = true;
      b.vel = { x: 0, y: 0 };
      sim.events.push({ kind: "pocket", ball: b.id, pocket: pocket >= 0 ? pocket : nearestPocket(b.pos) });
      continue;
    }
    cushion(b, sim);
  }
}

function applyFollowDraw(cue: Ball, impactSpeed: number, spin: SpinState) {
  spin.applied = true;
  if (spin.follow === 0) return;
  cue.vel = vec.add(cue.vel, vec.scale(spin.shotDir, spin.follow * FOLLOW_DRAW_FACTOR * impactSpeed));
}

function cushion(b: Ball, sim: Simulation & { spin: SpinState }) {
  const r = TABLE.ballRadius;
  const { width: w, height: h, cornerMouth: cm, sideMouthHalf: sm } = TABLE;
  const inTopBottomRail = (x: number) => x > cm && x < w - cm && Math.abs(x - w / 2) > sm;
  const inSideRail = (y: number) => y > cm && y < h - cm;
  let hit = false;
  if (b.pos.y < r && inTopBottomRail(b.pos.x) && b.vel.y < 0) {
    b.pos = { x: b.pos.x, y: r };
    b.vel = { x: b.vel.x, y: -b.vel.y * CUSHION_RESTITUTION };
    hit = true;
  } else if (b.pos.y > h - r && inTopBottomRail(b.pos.x) && b.vel.y > 0) {
    b.pos = { x: b.pos.x, y: h - r };
    b.vel = { x: b.vel.x, y: -b.vel.y * CUSHION_RESTITUTION };
    hit = true;
  }
  if (b.pos.x < r && inSideRail(b.pos.y) && b.vel.x < 0) {
    b.pos = { x: r, y: b.pos.y };
    b.vel = { x: -b.vel.x * CUSHION_RESTITUTION, y: b.vel.y };
    hit = true;
  } else if (b.pos.x > w - r && inSideRail(b.pos.y) && b.vel.x > 0) {
    b.pos = { x: w - r, y: b.pos.y };
    b.vel = { x: -b.vel.x * CUSHION_RESTITUTION, y: b.vel.y };
    hit = true;
  }
  if (!hit) return;
  sim.events.push({ kind: "cushion", ball: b.id, pos: { ...b.pos } });
  if (b.id === 0 && sim.spin.side !== 0) {
    // Seitliches Effet: ein Teil der Geschwindigkeit dreht sich beim Abprall
    const speed = vec.len(b.vel);
    const tangent = { x: -b.vel.y / (speed || 1), y: b.vel.x / (speed || 1) };
    b.vel = vec.add(b.vel, vec.scale(tangent, sim.spin.side * SIDE_SPIN_FACTOR * speed));
    sim.spin.side *= 0.5;
  }
}

function isOffTable(p: Vec) {
  return p.x < -TABLE.ballRadius || p.y < -TABLE.ballRadius || p.x > TABLE.width + TABLE.ballRadius || p.y > TABLE.height + TABLE.ballRadius;
}

function nearestPocket(p: Vec) {
  let best = 0;
  POCKETS.forEach((q, i) => {
    if (vec.dist(p, q) < vec.dist(p, POCKETS[best]!)) best = i;
  });
  return best;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
