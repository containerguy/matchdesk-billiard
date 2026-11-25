import {
  advance,
  aimPreview,
  cloneBalls,
  isValidCuePlacement,
  startShot,
  type AimPreview,
  type Ball,
  type BillardEvent,
  type BillardMove,
  type BillardState,
  type PhysicsEvent,
  type Vec
} from "@bandenduell/billard";
import { otherSeat, type Seat } from "@bandenduell/core";

/** Physikschritte pro Millisekunde: 480 Hz Simulation = Echtzeit, unabhängig von der Bildrate. */
const STEPS_PER_MS = 0.48;
/** Höchstens so viele Schritte pro Frame, damit ein Ruckler nicht alles überspringt. */
const MAX_STEPS_PER_FRAME = 120;
/** Zugweg in Millimetern für volle Stoßstärke beim Ziehen mit der Maus. */
const FULL_PULL_MM = 420;
/** Touch: Bewegt sich der Finger weniger weit, gilt die Berührung als Tippen (Tischmaß). */
const TAP_SLOP_MM = 70;
/** Touch: Näher an der Weißen dreht der Finger den Queue langsamer, für feines Zielen (Tischmaß). */
const FINE_AIM_RADIUS_MM = 700;
/**
 * Touch: Beim Abheben rollt der Finger noch ein Stück. Bewegt er sich in diesem Zeitfenster vor dem
 * Loslassen kaum, gilt der Stand vom Beginn des Fensters, nicht die letzte kleine Bewegung.
 */
const LIFT_WINDOW_MS = 120;
const LIFT_SLOP_MM = 60;
/** Touch: So nah an der gesetzten Weißen beginnt ein Finger, sie neu zu setzen (Tischmaß). */
const GRAB_CUE_MM = 110;

export type Phase = "placing" | "aiming" | "rolling" | "over";
export type GuideMode = "normal" | "profi";

export type Snapshot = {
  state: BillardState;
  phase: Phase;
  /** Darf dieser Bildschirm gerade stoßen? (online nur, wenn man selbst am Zug ist) */
  canAct: boolean;
  angle: number;
  power: number;
  dragging: boolean;
  spin: Vec;
  guide: GuideMode;
  preview: AimPreview | null;
  /** Wo die weiße Kugel gerade gesetzt wird (eigene Maus oder Gegner). */
  placingPos: Vec | null;
  placingValid: boolean;
  log: string[];
  names: [string, string];
};

type Listener = () => void;
type Running = { sim: ReturnType<typeof startShot>; before: BillardState; seat: Seat; done: (balls: Ball[], physics: PhysicsEvent[]) => void };

/**
 * Gemeinsame Tisch-Steuerung für lokale und Online-Partien:
 * Zielen, Weiße setzen, Stoßstärke, Effet und das Abspielen eines Stoßes.
 */
export abstract class TableController {
  protected snapshot: Snapshot;
  private listeners = new Set<Listener>();
  private running: Running | null = null;
  private dragStart: Vec | null = null;
  /** Touch-Zielen: Startpunkt, letzter Punkt und ob der Finger schon gewischt hat. */
  private touchAim: { start: Vec; last: Vec; moved: boolean } | null = null;
  /** Touch: Verlauf der Geste (Zeit, Fingerposition, Zielwinkel), um das Abheben des Fingers herauszurechnen. */
  private trail: Array<{ t: number; p: Vec; angle: number }> = [];
  /** Zeitquelle in Millisekunden; in Tests ersetzbar. */
  protected clock: () => number = () => performance.now();
  /** Touch: Die Weiße folgt gerade dem Finger und wird beim Loslassen gesetzt. */
  private touchPlacing = false;
  /** Gesetzte weiße Kugel bei "Kugel in der Hand", bevor gestoßen wird. */
  protected placedCue: Vec | null = null;

  constructor(state: BillardState, names: [string, string], log: string[]) {
    this.snapshot = {
      state,
      phase: phaseOf(state),
      canAct: false,
      angle: 0,
      power: 0,
      dragging: false,
      spin: { x: 0, y: 0 },
      guide: "normal",
      preview: null,
      placingPos: null,
      placingValid: false,
      log,
      names
    };
  }

  protected abstract mayAct(state: BillardState): boolean;
  protected abstract submit(move: BillardMove): void;
  /** Wird beim Zielen aufgerufen, z. B. um es dem Gegner zu zeigen. */
  protected onAim(): void {}

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Kugeln, wie sie gezeichnet werden sollen. */
  currentBalls(): Ball[] {
    if (this.running) return this.running.sim.balls;
    return this.ballsWithPlacedCue();
  }

  setGuide(guide: GuideMode) {
    this.set({ guide });
  }

  setSpin(spin: Vec) {
    const l = Math.hypot(spin.x, spin.y);
    this.set({ spin: l > 1 ? { x: spin.x / l, y: spin.y / l } : spin });
  }

  setPower(power: number) {
    if (!this.snapshot.canAct || this.snapshot.phase !== "aiming") return;
    this.set({ power: Math.min(1, Math.max(0, power)) });
    this.onAim();
  }

  /** Stoßen mit der eingestellten Stärke (Knopf, für Touch und Tastatur). */
  shootNow() {
    const s = this.snapshot;
    if (!s.canAct || s.phase !== "aiming" || s.power < 0.02) return;
    this.fire();
  }

  /** Dreht die Zielrichtung um einen kleinen Winkel (Feineinstellung per Knopf oder Taste). */
  nudgeAim(degrees: number) {
    const s = this.snapshot;
    if (!s.canAct || s.phase !== "aiming") return;
    this.aimAngle(s.angle + (degrees * Math.PI) / 180);
  }

  pointerMove(p: Vec, touch: boolean) {
    const s = this.snapshot;
    if (!s.canAct) return;
    if (s.phase === "placing") {
      if (touch && !this.touchPlacing) return;
      if (touch) this.remember(p, s.angle);
      this.set({ placingPos: p, placingValid: isValidCuePlacement(s.state, p) });
      this.onAim();
      return;
    }
    if (s.phase !== "aiming") return;
    if (touch) {
      // Wischen dreht den Queue um die Weiße, ohne dass er zum Finger springt
      const aim = this.touchAim;
      if (!aim) return;
      if (!aim.moved) {
        if (Math.hypot(p.x - aim.start.x, p.y - aim.start.y) < TAP_SLOP_MM) return;
        aim.moved = true;
        aim.last = p;
        return;
      }
      const cue = this.ballsWithPlacedCue().find((b) => b.id === 0)!.pos;
      const a = { x: aim.last.x - cue.x, y: aim.last.y - cue.y };
      const b = { x: p.x - cue.x, y: p.y - cue.y };
      const turn = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
      const reach = Math.sqrt(Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      aim.last = p;
      const angle = s.angle + turn * Math.min(1, reach / FINE_AIM_RADIUS_MM);
      this.remember(p, angle);
      this.aimAngle(angle);
      return;
    }
    if (this.dragStart && !touch) {
      const power = Math.min(1, Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) / FULL_PULL_MM);
      this.set({ power });
      this.onAim();
      return;
    }
    this.aimAt(p);
  }

  pointerDown(p: Vec, touch: boolean) {
    const s = this.snapshot;
    if (!s.canAct) return;
    if (s.phase === "placing" && touch) {
      // Touch: die Weiße folgt dem Finger und wird erst beim Loslassen gesetzt
      this.touchPlacing = true;
      this.trail = [];
      this.remember(p, s.angle);
      this.set({ placingPos: p, placingValid: isValidCuePlacement(s.state, p) });
      this.onAim();
      return;
    }
    if (s.phase === "placing") {
      if (!isValidCuePlacement(s.state, p)) {
        this.set({ placingPos: p, placingValid: false });
        return;
      }
      this.placedCue = { ...p };
      this.set({ phase: "aiming", placingPos: null });
      this.aimAt(touch ? cueTowardsCenter(p) : (this.lastPointer ?? cueTowardsCenter(p)));
      return;
    }
    if (s.phase !== "aiming") return;
    if (touch) {
      // Mit Kugel in der Hand lässt sich die gesetzte Weiße mit dem Finger noch einmal verschieben
      if (this.placedCue && Math.hypot(p.x - this.placedCue.x, p.y - this.placedCue.y) < GRAB_CUE_MM) {
        this.touchPlacing = true;
        this.replacing = true;
        const pos = { ...this.placedCue };
        this.placedCue = null;
        this.trail = [];
        this.remember(pos, s.angle);
        this.set({ phase: "placing", placingPos: pos, placingValid: true, preview: null });
        return;
      }
      // Touch: Wischen dreht den Queue, Tippen zielt auf den Punkt; die Stärke kommt vom Regler
      this.touchAim = { start: p, last: p, moved: false };
      this.trail = [];
      this.remember(p, s.angle);
      return;
    }
    this.dragStart = p;
    this.set({ dragging: true, power: 0 });
  }

  pointerUp(touch: boolean) {
    const s = this.snapshot;
    if (touch) {
      const aim = this.touchAim;
      this.touchAim = null;
      if (this.touchPlacing) {
        this.touchPlacing = false;
        const keepAngle = this.replacing;
        this.replacing = false;
        if (s.phase !== "placing" || !s.canAct || !s.placingPos) return;
        // Die Stelle vor dem Abheben des Fingers zählt, sofern die Weiße dort liegen darf
        const settled = this.settled();
        const pos = settled && isValidCuePlacement(s.state, settled.p) ? settled.p : s.placingPos;
        if (pos === s.placingPos && !s.placingValid) return;
        this.placedCue = { ...pos };
        this.set({ phase: "aiming", placingPos: null });
        if (keepAngle) this.aimAngle(s.angle);
        else this.aimAt(cueTowardsCenter(this.placedCue));
        return;
      }
      if (!aim || s.phase !== "aiming" || !s.canAct) return;
      if (!aim.moved) {
        this.aimAt(aim.start);
        return;
      }
      // Die letzte kleine Bewegung beim Abheben des Fingers verstellt das Ziel nicht
      const settled = this.settled();
      if (settled && settled.angle !== s.angle) this.aimAngle(settled.angle);
      return;
    }
    const wasDragging = this.dragStart !== null;
    this.dragStart = null;
    if (touch || !wasDragging || s.phase !== "aiming" || !s.canAct) return;
    if (s.power < 0.02) {
      this.set({ dragging: false, power: 0 });
      return;
    }
    this.fire();
  }

  /** Bricht eine laufende Drag-Geste ab (z. B. wenn der Zeiger das Fenster verlässt). */
  cancelDrag() {
    this.dragStart = null;
    this.touchAim = null;
    this.touchPlacing = false;
    this.replacing = false;
    if (this.snapshot.dragging) this.set({ dragging: false });
  }

  private lastPointer: Vec | null = null;
  /** Die gesetzte Weiße wird gerade noch einmal verschoben: die Zielrichtung bleibt danach erhalten. */
  private replacing = false;

  private remember(p: Vec, angle: number) {
    this.trail.push({ t: this.clock(), p, angle });
    if (this.trail.length > 64) this.trail.shift();
  }

  /**
   * Stand der Geste vor dem Abheben: Hat sich der Finger im letzten Zeitfenster kaum bewegt, ist das
   * der letzte Stand vor diesem Fenster. Bei einer zügigen Bewegung bis zum Schluss gilt der Endstand (`null`).
   */
  private settled(): { p: Vec; angle: number } | null {
    const from = this.clock() - LIFT_WINDOW_MS;
    const before = this.trail.filter((sample) => sample.t <= from);
    const anchor = before[before.length - 1];
    if (!anchor) return null;
    const late = [anchor, ...this.trail.filter((sample) => sample.t > from)];
    let travelled = 0;
    for (let i = 1; i < late.length; i++) travelled += Math.hypot(late[i]!.p.x - late[i - 1]!.p.x, late[i]!.p.y - late[i - 1]!.p.y);
    return travelled <= LIFT_SLOP_MM ? anchor : null;
  }

  private aimAngle(angle: number) {
    this.set({ angle, preview: aimPreview(this.ballsWithPlacedCue(), angle) });
    this.onAim();
  }

  private aimAt(p: Vec) {
    this.lastPointer = p;
    const balls = this.ballsWithPlacedCue();
    const cue = balls.find((b) => b.id === 0)!;
    const angle = Math.atan2(p.y - cue.pos.y, p.x - cue.pos.x);
    this.set({ angle, preview: aimPreview(balls, angle) });
    this.onAim();
  }

  private fire() {
    const s = this.snapshot;
    const move: BillardMove = { shot: { angle: s.angle, power: s.power, spin: s.spin } };
    if (this.placedCue) move.cueBallPos = { ...this.placedCue };
    this.set({ dragging: false, canAct: false });
    this.submit(move);
  }

  /** Spielt einen Stoß ab; `done` bekommt die Kugeln nach dem Stillstand. */
  protected play(before: BillardState, seat: Seat, move: BillardMove, done: Running["done"]) {
    const balls = cloneBalls(before.balls);
    if (move.cueBallPos) {
      const cue = balls.find((b) => b.id === 0)!;
      cue.pos = { ...move.cueBallPos };
      cue.potted = false;
    }
    const placed: BillardState = { ...before, balls };
    this.placedCue = null;
    this.running = { sim: startShot(balls, move.shot), before: placed, seat, done };
    this.set({ phase: "rolling", canAct: false, preview: null, placingPos: null, angle: move.shot.angle, power: move.shot.power });
  }

  /** Bricht einen laufenden Stoß ab, ohne ihn zu werten (z. B. wenn neu aufgebaut wird). */
  protected abortShot() {
    this.running = null;
  }

  protected isRolling() {
    return this.running !== null;
  }

  /** Einen Frame weiterrechnen; `elapsedMs` = Zeit seit dem letzten Frame. */
  tick(elapsedMs: number) {
    const run = this.running;
    if (!run) return;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.round(elapsedMs * STEPS_PER_MS)));
    if (!advance(run.sim, steps)) return;
    this.finish(run);
  }

  /** Stoß sofort zu Ende rechnen (z. B. wenn der Tab im Hintergrund ist). */
  fastForward() {
    const run = this.running;
    if (!run) return;
    advance(run.sim, Number.MAX_SAFE_INTEGER);
    this.finish(run);
  }

  private finish(run: Running) {
    this.running = null;
    run.done(run.sim.balls, run.sim.events);
  }

  /** Übernimmt einen neuen Spielzustand (nach einem Stoß oder vom Server). */
  protected adopt(state: BillardState, extraLog: string[] = []) {
    this.placedCue = null;
    const phase = phaseOf(state);
    const canAct = this.mayAct(state) && phase !== "over";
    this.set({
      state,
      phase,
      canAct,
      power: 0,
      dragging: false,
      spin: { x: 0, y: 0 },
      placingPos: null,
      placingValid: false,
      preview: phase === "aiming" ? aimPreview(state.balls, this.snapshot.angle) : null,
      log: extraLog.length ? [...this.snapshot.log, ...extraLog] : this.snapshot.log
    });
  }

  /** Zeigt das Zielen des Gegners an. */
  protected showRemoteAim(angle: number, power: number, cuePos: Vec | null) {
    if (this.running) return;
    const s = this.snapshot;
    if (s.phase === "placing" && cuePos) {
      this.set({ placingPos: cuePos, placingValid: isValidCuePlacement(s.state, cuePos) });
      return;
    }
    if (cuePos) this.placedCue = cuePos;
    const balls = this.ballsWithPlacedCue();
    this.set({ phase: s.phase === "placing" ? "aiming" : s.phase, angle, power, dragging: power > 0, preview: aimPreview(balls, angle) });
  }

  protected log(lines: string[]) {
    this.set({ log: [...this.snapshot.log, ...lines] });
  }

  protected describe(e: BillardEvent): string[] {
    const n = this.snapshot.names;
    switch (e.kind) {
      case "potted":
        return [`${n[e.seat]} versenkt die ${e.ball}.`];
      case "groupsAssigned":
        return [`${n[e.seat]} spielt ${e.group === "solids" ? "die Vollen" : "die Halben"}, ${n[otherSeat(e.seat)]} ${e.group === "solids" ? "die Halben" : "die Vollen"}.`];
      case "foul":
        return [
          `Foul von ${n[e.seat]}: ${e.reason}. ${n[otherSeat(e.seat)]} hat Kugel in der Hand${this.snapshot.state.isBreak && e.reason === "weiße versenkt" ? " im Kopffeld" : ""}.`
        ];
      case "eightRespotted":
        return ["Die 8 fiel beim Anstoß und wird zurückgesetzt."];
      case "rebreak":
        return [`Ungültiger Anstoß von ${n[otherSeat(e.seat)]} (${e.reason}). Es wird neu aufgebaut, ${n[e.seat]} stößt an.`];
      case "turn":
        return [];
      case "won":
        return [`${n[e.seat]} gewinnt (${e.reason}).`];
    }
  }

  protected set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  /** Aktuelle Position der weißen Kugel, wie sie gesetzt wurde (für den Gegner). */
  protected cuePosForAim(): Vec | null {
    if (this.snapshot.phase === "placing") return this.snapshot.placingPos;
    return this.placedCue;
  }

  private ballsWithPlacedCue(): Ball[] {
    const balls = this.snapshot.state.balls;
    if (!this.placedCue) return balls;
    return balls.map((b) => (b.id === 0 ? { ...b, pos: { ...this.placedCue! }, potted: false } : b));
  }
}

function phaseOf(state: BillardState): Phase {
  return state.winner !== null ? "over" : state.ballInHand ? "placing" : "aiming";
}

function cueTowardsCenter(p: Vec): Vec {
  return { x: p.x + 400, y: p.y };
}
