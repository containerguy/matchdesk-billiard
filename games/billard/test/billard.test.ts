import { describe, expect, it } from "vitest";
import {
  aimPreview,
  billard,
  eightPocket,
  judgeShot,
  oppositePocket,
  POCKETS,
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
  return { balls, turn: 0, groups: [null, null], ballInHand: false, isBreak: false, fromKitchen: false, lastPocket: { solids: null, stripes: null }, winner: null, winReason: null, shots: 1, ...partial };
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
  const rail: PhysicsEvent = { kind: "cushion", ball: 1, pos: { x: 1000, y: 28 } };
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

  describe("Kneipenregel für die 8", () => {
    const solidsGone = [1, 2, 3, 4, 5, 6, 7].map((id) => ball(id, 0, 0, true));
    const onEight = (lastSolid: number | null) =>
      stateWith([ball(0, 300, 300), ...solidsGone, ball(8, 600, 600), ball(9, 900, 900)], {
        groups: ["solids", "stripes"],
        lastPocket: { solids: lastSolid, stripes: null }
      });
    const potEight = (before: BillardState, into: number, extra: PhysicsEvent[] = []) =>
      judgeShot(before, 0, before.balls.map((b) => (b.id === 8 ? { ...b, potted: true } : b)), [contact(8), { kind: "pocket", ball: 8, pocket: into }, ...extra]);

    it("merkt sich je Gruppe die Tasche der zuletzt versenkten Kugel", () => {
      const before = stateWith([ball(0, 300, 300), ball(2, 600, 600), ball(3, 700, 600), ball(8, 1200, 600)], { groups: ["solids", "stripes"] });
      const { state } = judgeShot(before, 0, before.balls, [contact(2), { kind: "pocket", ball: 2, pocket: 4 }, { kind: "pocket", ball: 3, pocket: 2 }]);
      expect(state.lastPocket).toEqual({ solids: 2, stripes: null });
    });

    it("gibt die gegenüberliegende Tasche vor: Ecke zu diagonaler Ecke, Mitte zu Mitte", () => {
      expect([0, 1, 2, 3, 4, 5].map(oppositePocket)).toEqual([5, 4, 3, 2, 1, 0]);
      for (const index of [0, 1, 2]) {
        const a = POCKETS[index]!;
        const b = POCKETS[oppositePocket(index)]!;
        expect(a.x + b.x).toBeCloseTo(TABLE.width);
        expect(a.y + b.y).toBeCloseTo(TABLE.height);
      }
      expect(eightPocket(onEight(2), 0)).toBe(3);
      expect(eightPocket(onEight(2), 1)).toBeNull();
    });

    it("8 in der vorgegebenen Tasche gewinnt", () => {
      const { state } = potEight(onEight(0), 5);
      expect(state).toMatchObject({ winner: 0, winReason: "8 regulär versenkt" });
    });

    it("8 in einer anderen Tasche verliert", () => {
      const { state } = potEight(onEight(0), 4);
      expect(state).toMatchObject({ winner: 1, winReason: "8 in die falsche Tasche versenkt" });
    });

    it("8 in der richtigen Tasche verliert, wenn die Weiße mitfällt", () => {
      const { state } = potEight(onEight(0), 5, [{ kind: "pocket", ball: 0, pocket: 1 }]);
      expect(state).toMatchObject({ winner: 1, winReason: "8 mit Foul versenkt" });
    });
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

  describe("Anstoß und Kopffeld", () => {
    const fresh = () => billard.createInitialState({ seed: 7, startingSeat: 0 });
    const breakShot = (power: number, angle = 0) => ({ shot: { angle, power, spin: noSpin }, cueBallPos: { x: 500, y: 560 } });

    it("wertet einen kräftigen Anstoß als gültig", () => {
      const { state, events } = billard.applyMove(fresh(), 0, breakShot(0.95));
      expect(events.some((e) => e.kind === "rebreak")).toBe(false);
      expect(state.isBreak).toBe(false);
    });

    it("baut nach einem zu schwachen Anstoß neu auf und lässt den Gegner anstoßen", () => {
      const { state, events } = billard.applyMove(fresh(), 0, breakShot(0.2));
      expect(events).toEqual([{ kind: "rebreak", seat: 1, reason: "zu wenige Kugeln an der Bande" }]);
      expect(state).toMatchObject({ turn: 1, isBreak: true, ballInHand: true, shots: 1, winner: null });
      expect(state.balls.filter((b) => b.id !== 0 && !b.potted)).toHaveLength(15);
    });

    it("baut auch neu auf, wenn der Anstoß das Dreieck verfehlt", () => {
      const { state, events } = billard.applyMove(fresh(), 0, breakShot(0.3, -Math.PI / 2));
      expect(events).toEqual([{ kind: "rebreak", seat: 1, reason: "Dreieck nicht getroffen" }]);
      expect(state.turn).toBe(1);
    });

    it("gibt nach versenkter Weißer beim Anstoß Kugel in der Hand nur im Kopffeld", () => {
      const before = stateWith([ball(0, 300, 560), ball(1, 1700, 560), ball(8, 1900, 300)], { isBreak: true });
      const { state } = judgeShot(before, 0, [ball(0, 0, 0, true), ball(1, 1800, 560), ball(8, 1900, 300)], [contact(1), pocket(0)]);
      expect(state).toMatchObject({ turn: 1, ballInHand: true, fromKitchen: true });
      expect(billard.checkMove(state, 1, { shot: { angle: 0, power: 0.5, spin: noSpin }, cueBallPos: { x: 900, y: 560 } }).ok).toBe(false);
      expect(billard.checkMove(state, 1, { shot: { angle: 0, power: 0.5, spin: noSpin }, cueBallPos: { x: 400, y: 560 } }).ok).toBe(true);
    });

    it("ahndet es, eine Kugel im Kopffeld direkt aus dem Kopffeld anzuspielen", () => {
      const before = stateWith([ball(0, 200, 560), ball(1, 450, 560), ball(8, 1900, 300)], { fromKitchen: true, ballInHand: true });
      const after = [ball(0, 300, 560), ball(1, 900, 560), ball(8, 1900, 300)];
      const direct = judgeShot(before, 0, after, [contact(1), rail]);
      expect(direct.events).toContainEqual({ kind: "foul", seat: 0, reason: "Kugel im Kopffeld direkt angespielt" });
      expect(direct.state.fromKitchen).toBe(false);
      const viaRail = judgeShot(before, 0, after, [{ kind: "cushion", ball: 0, pos: { x: 2200, y: 560 } }, contact(1), rail]);
      expect(viaRail.events.some((e) => e.kind === "foul")).toBe(false);
    });
  });
});
