import { describe, expect, it } from "vitest";
import {
  aimPreview,
  billard,
  judgeShot,
  rack8Ball,
  simulateShot,
  TABLE,
  vec,
  type Ball,
  type BillardState,
  type PhysicsEvent
} from "../src";

const ball = (id: number, x: number, y: number, potted = false): Ball => ({ id, pos: { x, y }, vel: { x: 0, y: 0 }, potted });
const noSpin = { x: 0, y: 0 };

function stateWith(balls: Ball[], partial: Partial<BillardState> = {}): BillardState {
  return { balls, turn: 0, groups: [null, null], ballInHand: false, isBreak: false, winner: null, winReason: null, shots: 1, ...partial };
}

describe("Dreieck", () => {
  it("legt 16 Kugeln ohne Überlappung, die 8 in der Mitte", () => {
    const balls = rack8Ball(42);
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((b) => b.id)).size).toBe(16);
    for (const a of balls) for (const b of balls) if (a !== b) expect(vec.dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 * TABLE.ballRadius);
    const xs = balls.filter((b) => b.id !== 0).map((b) => b.pos.x);
    const eight = balls.find((b) => b.id === 8)!;
    expect(eight.pos.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 5);
  });

  it("ist bei gleichem Seed gleich", () => {
    expect(rack8Ball(7)).toEqual(rack8Ball(7));
  });
});

describe("Physik", () => {
  it("ist deterministisch", () => {
    const balls = rack8Ball(1);
    const shot = { angle: 0.01, power: 0.9, spin: { x: 0.2, y: -0.3 } };
    expect(simulateShot(balls, shot)).toEqual(simulateShot(balls, shot));
  });

  it("bringt alle Kugeln zum Stillstand und lässt keine vom Tisch", () => {
    const sim = simulateShot(rack8Ball(3), { angle: 0, power: 1, spin: noSpin });
    expect(sim.done).toBe(true);
    for (const b of sim.balls) {
      expect(b.vel).toEqual({ x: 0, y: 0 });
      if (!b.potted) {
        expect(b.pos.x).toBeGreaterThanOrEqual(TABLE.ballRadius - 0.5);
        expect(b.pos.x).toBeLessThanOrEqual(TABLE.width - TABLE.ballRadius + 0.5);
      }
    }
  });

  it("überträgt bei geradem Stoß fast alle Geschwindigkeit auf die Objektkugel", () => {
    const sim = simulateShot([ball(0, 500, 560), ball(1, 800, 560)], { angle: 0, power: 0.3, spin: noSpin });
    const cue = sim.balls.find((b) => b.id === 0)!;
    const one = sim.balls.find((b) => b.id === 1)!;
    expect(one.pos.x - 800).toBeGreaterThan(5 * (cue.pos.x - 500 - 300 + 2 * TABLE.ballRadius));
  });

  it("versenkt eine Kugel, die gerade auf die Ecktasche läuft", () => {
    const sim = simulateShot([ball(0, 600, 600), ball(3, 300, 300)], { angle: Math.atan2(-1, -1), power: 0.4, spin: noSpin });
    expect(sim.events).toContainEqual({ kind: "pocket", ball: 3, pocket: 0 });
  });

  it("Rücklauf lässt die weiße Kugel zurückkommen", () => {
    const layout = [ball(0, 500, 560), ball(1, 800, 560)];
    const draw = simulateShot(layout, { angle: 0, power: 0.4, spin: { x: 0, y: 0.9 } });
    expect(draw.balls.find((b) => b.id === 0)!.pos.x).toBeLessThan(800 - 2 * TABLE.ballRadius - 1);
  });
});

describe("Zielhilfe", () => {
  it("findet die erste getroffene Kugel und die Geisterkugel", () => {
    const preview = aimPreview([ball(0, 500, 560), ball(5, 900, 560), ball(6, 1200, 560)], 0)!;
    expect(preview.target?.id).toBe(5);
    expect(preview.end.x).toBeCloseTo(900 - 2 * TABLE.ballRadius, 5);
  });

  it("endet ohne Kugel an der Bande", () => {
    const preview = aimPreview([ball(0, 500, 560)], Math.PI)!;
    expect(preview.target).toBeNull();
    expect(preview.end.x).toBeCloseTo(TABLE.ballRadius, 5);
  });
});

describe("8-Ball-Regeln", () => {
  const contact = (b: number): PhysicsEvent => ({ kind: "ballContact", a: 0, b });
  const rail: PhysicsEvent = { kind: "cushion", ball: 1 };
  const pocket = (b: number): PhysicsEvent => ({ kind: "pocket", ball: b, pocket: 0 });

  it("weist nach dem ersten Treffer die Gruppen zu und der Spieler bleibt dran", () => {
    const before = stateWith([ball(0, 300, 300), ball(2, 600, 600), ball(10, 900, 600), ball(8, 1200, 600)]);
    const after = before.balls.map((b) => (b.id === 2 ? { ...b, potted: true } : b));
    const { state, events } = judgeShot(before, 0, after, [contact(2), pocket(2)]);
    expect(state.groups).toEqual(["solids", "stripes"]);
    expect(state.turn).toBe(0);
    expect(events).toContainEqual({ kind: "groupsAssigned", seat: 0, group: "solids" });
  });

  it("gibt bei versenkter Weißen Kugel in der Hand an den Gegner", () => {
    const before = stateWith([ball(0, 300, 300), ball(2, 600, 600)], { groups: ["solids", "stripes"] });
    const after = before.balls.map((b) => (b.id === 0 ? { ...b, potted: true } : b));
    const { state, events } = judgeShot(before, 0, after, [contact(2), pocket(0)]);
    expect(state.turn).toBe(1);
    expect(state.ballInHand).toBe(true);
    expect(state.balls.find((b) => b.id === 0)!.potted).toBe(false);
    expect(events).toContainEqual({ kind: "foul", seat: 0, reason: "weiße versenkt" });
  });

  it("wertet falsche Kugel zuerst als Foul", () => {
    const before = stateWith([ball(0, 300, 300), ball(2, 600, 600), ball(10, 900, 600)], { groups: ["solids", "stripes"] });
    const { state, events } = judgeShot(before, 0, before.balls, [contact(10), rail]);
    expect(state.turn).toBe(1);
    expect(events).toContainEqual({ kind: "foul", seat: 0, reason: "falsche Kugel zuerst" });
  });

  it("wertet einen Treffer ohne Bande als Foul", () => {
    const before = stateWith([ball(0, 300, 300), ball(2, 600, 600)], { groups: ["solids", "stripes"] });
    const { events } = judgeShot(before, 0, before.balls, [contact(2)]);
    expect(events).toContainEqual({ kind: "foul", seat: 0, reason: "keine Bande nach dem Treffer" });
  });

  it("8 versenkt nach geräumter Gruppe gewinnt", () => {
    const solidsGone = [1, 2, 3, 4, 5, 6, 7].map((id) => ball(id, 0, 0, true));
    const before = stateWith([ball(0, 300, 300), ...solidsGone, ball(8, 600, 600), ball(9, 900, 900)], { groups: ["solids", "stripes"] });
    const after = before.balls.map((b) => (b.id === 8 ? { ...b, potted: true } : b));
    const { state } = judgeShot(before, 0, after, [contact(8), pocket(8)]);
    expect(state.winner).toBe(0);
  });

  it("8 zu früh versenkt verliert", () => {
    const before = stateWith([ball(0, 300, 300), ball(1, 400, 400), ball(8, 600, 600)], { groups: ["solids", "stripes"] });
    const after = before.balls.map((b) => (b.id === 8 ? { ...b, potted: true } : b));
    const { state } = judgeShot(before, 0, after, [contact(1), pocket(8)]);
    expect(state.winner).toBe(1);
  });

  it("8 beim Anstoß wird zurückgesetzt", () => {
    const before = stateWith([ball(0, 300, 560), ball(8, 1700, 560)], { isBreak: true });
    const after = before.balls.map((b) => (b.id === 8 ? { ...b, potted: true } : b));
    const { state, events } = judgeShot(before, 0, after, [contact(8), pocket(8)]);
    expect(state.winner).toBeNull();
    expect(state.balls.find((b) => b.id === 8)!.potted).toBe(false);
    expect(events).toContainEqual({ kind: "eightRespotted" });
  });

  it("lehnt Züge vom falschen Spieler und Weiße vor der Kopflinie beim Anstoß ab", () => {
    const state = billard.createInitialState({ seed: 1, startingSeat: 0 });
    expect(billard.checkMove(state, 1, { shot: { angle: 0, power: 0.5, spin: noSpin } }).ok).toBe(false);
    expect(billard.checkMove(state, 0, { shot: { angle: 0, power: 0.5, spin: noSpin }, cueBallPos: { x: 1200, y: 560 } }).ok).toBe(false);
    expect(billard.checkMove(state, 0, { shot: { angle: 0, power: 0.5, spin: noSpin }, cueBallPos: { x: 400, y: 560 } }).ok).toBe(true);
  });

  it("spielt einen Anstoß komplett durch", () => {
    const state = billard.createInitialState({ seed: 5, startingSeat: 0 });
    const { state: next, events } = billard.applyMove(state, 0, { shot: { angle: 0, power: 1, spin: noSpin } });
    expect(next.isBreak).toBe(false);
    expect(next.shots).toBe(1);
    expect(events.some((e) => e.kind === "turn" || e.kind === "won")).toBe(true);
  });
});
