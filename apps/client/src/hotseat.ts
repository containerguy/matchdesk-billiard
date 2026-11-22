import {
  advance,
  aimPreview,
  billard,
  cloneBalls,
  isValidCuePlacement,
  judgeShot,
  startShot,
  type AimPreview,
  type BillardEvent,
  type BillardMove,
  type BillardState,
  type Vec
} from "@spielhalle/billard";
import { otherSeat, type Seat } from "@spielhalle/core";

/** Physikschritte pro Bildschirm-Frame bei 60 fps: 480 Hz Simulation = Echtzeit. */
const STEPS_PER_FRAME = 8;
/** Zugweg in Millimetern für volle Stoßstärke. */
const FULL_PULL_MM = 420;

export type Phase = "placing" | "aiming" | "rolling" | "over";
export type GuideMode = "normal" | "profi";

export type Snapshot = {
  state: BillardState;
  phase: Phase;
  angle: number;
  power: number;
  dragging: boolean;
  spin: Vec;
  guide: GuideMode;
  preview: AimPreview | null;
  /** Position der weißen Kugel, während sie gesetzt wird. */
  placingPos: Vec | null;
  placingValid: boolean;
  log: string[];
  names: [string, string];
};

type Listener = () => void;

/**
 * Lokale Partie an einem Rechner: zwei Spieler stoßen abwechselnd.
 * Nutzt dieselbe Physik und dieselben Regeln, die später der Server ausführt.
 */
export class HotseatGame {
  private snapshot: Snapshot;
  private listeners = new Set<Listener>();
  private sim: ReturnType<typeof startShot> | null = null;
  private before: BillardState | null = null;
  private dragStart: Vec | null = null;

  constructor(names: [string, string] = ["Spieler 1", "Spieler 2"], seed = Date.now()) {
    const state = billard.createInitialState({ seed, startingSeat: 0 });
    this.snapshot = {
      state,
      phase: "placing",
      angle: 0,
      power: 0,
      dragging: false,
      spin: { x: 0, y: 0 },
      guide: "normal",
      preview: null,
      placingPos: null,
      placingValid: false,
      log: [`${names[0]} hat den Anstoß. Weiße Kugel hinter die Kopflinie setzen.`],
      names
    };
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Kugeln, wie sie gerade gezeichnet werden sollen (während des Rollens aus der Simulation). */
  currentBalls() {
    return this.sim ? this.sim.balls : this.snapshot.state.balls;
  }

  newGame() {
    const fresh = new HotseatGame(this.snapshot.names);
    this.sim = null;
    this.before = null;
    this.dragStart = null;
    this.set({ ...fresh.snapshot, guide: this.snapshot.guide });
  }

  setGuide(guide: GuideMode) {
    this.set({ guide });
  }

  setSpin(spin: Vec) {
    const l = Math.hypot(spin.x, spin.y);
    this.set({ spin: l > 1 ? { x: spin.x / l, y: spin.y / l } : spin });
  }

  pointerMove(p: Vec) {
    const s = this.snapshot;
    if (s.phase === "placing") {
      this.set({ placingPos: p, placingValid: isValidCuePlacement(s.state, p) });
      return;
    }
    if (s.phase !== "aiming") return;
    if (this.dragStart) {
      const power = Math.min(1, Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) / FULL_PULL_MM);
      this.set({ power });
      return;
    }
    const cue = s.state.balls.find((b) => b.id === 0)!;
    const angle = Math.atan2(p.y - cue.pos.y, p.x - cue.pos.x);
    this.set({ angle, preview: aimPreview(s.state.balls, angle) });
  }

  pointerDown(p: Vec) {
    const s = this.snapshot;
    if (s.phase === "placing") {
      if (!isValidCuePlacement(s.state, p)) return;
      const balls = cloneBalls(s.state.balls);
      const cue = balls.find((b) => b.id === 0)!;
      cue.pos = { ...p };
      cue.potted = false;
      const state = { ...s.state, balls };
      this.set({ state, phase: "aiming", placingPos: null, preview: aimPreview(balls, s.angle) });
      return;
    }
    if (s.phase === "aiming") {
      this.dragStart = p;
      this.set({ dragging: true, power: 0 });
    }
  }

  pointerUp() {
    const s = this.snapshot;
    if (!this.dragStart || s.phase !== "aiming") return;
    this.dragStart = null;
    if (s.power < 0.02) {
      this.set({ dragging: false, power: 0 });
      return;
    }
    this.shoot();
  }

  /** Einen Frame weiterrechnen; liefert true, solange Kugeln rollen. */
  tick(): boolean {
    if (!this.sim || !this.before) return false;
    const done = advance(this.sim, STEPS_PER_FRAME);
    if (!done) return true;
    const seat = this.before.turn;
    const { state, events } = judgeShot(this.before, seat, this.sim.balls, this.sim.events);
    this.sim = null;
    this.before = null;
    const log = [...this.snapshot.log, ...events.flatMap((e) => this.describe(e))];
    const phase: Phase = state.winner !== null ? "over" : state.ballInHand ? "placing" : "aiming";
    this.set({
      state,
      phase,
      log,
      power: 0,
      spin: { x: 0, y: 0 },
      preview: phase === "aiming" ? aimPreview(state.balls, this.snapshot.angle) : null
    });
    return false;
  }

  private shoot() {
    const s = this.snapshot;
    const move: BillardMove = { shot: { angle: s.angle, power: s.power, spin: s.spin } };
    const check = billard.checkMove(s.state, s.state.turn, move);
    if (!check.ok) {
      this.set({ dragging: false, log: [...s.log, check.reason] });
      return;
    }
    this.before = s.state;
    this.sim = startShot(s.state.balls, move.shot);
    this.set({ phase: "rolling", dragging: false, preview: null });
  }

  private describe(e: BillardEvent): string[] {
    const n = this.snapshot.names;
    switch (e.kind) {
      case "potted":
        return [`${n[e.seat]} versenkt die ${e.ball}.`];
      case "groupsAssigned":
        return [`${n[e.seat]} spielt ${e.group === "solids" ? "die Vollen" : "die Halben"}, ${n[otherSeat(e.seat)]} ${e.group === "solids" ? "die Halben" : "die Vollen"}.`];
      case "foul":
        return [`Foul von ${n[e.seat]}: ${e.reason}. ${n[otherSeat(e.seat)]} hat Kugel in der Hand.`];
      case "eightRespotted":
        return ["Die 8 fiel beim Anstoß und wird zurückgesetzt."];
      case "turn":
        return [`${n[e.seat]} ist am Zug.`];
      case "won":
        return [`${n[e.seat]} gewinnt (${e.reason}).`];
    }
  }

  private set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}

export function seatLabel(seat: Seat, names: [string, string]) {
  return names[seat];
}
