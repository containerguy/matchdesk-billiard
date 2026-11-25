import { describe, expect, it } from "vitest";
import { applyMove, checkMove, chooseBotMove, createInitialState, TABLE, type Ball, type BillardState, type BotLevel } from "../src";

function playOut(levels: [BotLevel, BotLevel], seed: number) {
  let state = createInitialState({ seed, startingSeat: 0 });
  let shots = 0;
  while (state.winner === null && shots < 300) {
    const seat = state.turn;
    const move = chooseBotMove(state, seat, levels[seat], seed + shots);
    expect(checkMove(state, seat, move)).toEqual({ ok: true });
    state = applyMove(state, seat, move).state;
    shots++;
  }
  return state;
}

/** Stellung mit Weißer, einer vollen Kugel gerade vor der Ecktasche und der 8 abseits. */
function straightIn(): BillardState {
  const ball = (id: number, x: number, y: number, potted = false): Ball => ({ id, pos: { x, y }, vel: { x: 0, y: 0 }, potted });
  const balls = [ball(0, 1400, 700), ball(1, 1900, 950), ball(8, 400, 200), ball(9, 300, 900)];
  for (let id = 2; id <= 15; id++) if (id !== 8 && id !== 9) balls.push(ball(id, 0, 0, true));
  return { balls, turn: 0, groups: ["solids", "stripes"], ballInHand: false, isBreak: false, fromKitchen: false, lastPocket: { solids: null, stripes: null }, winner: null, winReason: null, shots: 5 };
}

describe("Computergegner", () => {
  it("wählt bei gleichem Zustand und Seed denselben Stoß", () => {
    const state = straightIn();
    expect(chooseBotMove(state, 0, "medium", 7)).toEqual(chooseBotMove(state, 0, "medium", 7));
  });

  describe("Kneipenregel", () => {
    const onEight = (eight: { x: number; y: number }, cue: { x: number; y: number }, lastSolid: number): BillardState => {
      const base = straightIn();
      const balls = base.balls.map((b) => (b.id === 1 ? { ...b, potted: true } : b.id === 8 ? { ...b, pos: eight } : b.id === 0 ? { ...b, pos: cue } : b));
      return { ...base, balls, lastPocket: { solids: lastSolid, stripes: null } };
    };

    it("versenkt die 8 in der vorgegebenen Tasche", () => {
      // Vorgabe oben Mitte (letzte Kugel fiel unten Mitte), die 8 liegt gerade davor
      const state = onEight({ x: 1120, y: 300 }, { x: 1120, y: 800 }, 4);
      for (let seed = 0; seed < 5; seed++) {
        expect(applyMove(state, 0, chooseBotMove(state, 0, "hard", seed)).state).toMatchObject({ winner: 0, winReason: "8 regulär versenkt" });
      }
    });

    it("spielt die 8 nicht in eine andere Tasche, auch wenn sie dort gerade liegt", () => {
      // Die 8 liegt gerade vor der Tasche unten rechts, vorgegeben ist die Tasche oben rechts
      const state = onEight({ x: 1900, y: 950 }, { x: 1400, y: 700 }, 3);
      for (let seed = 0; seed < 5; seed++) {
        expect(applyMove(state, 0, chooseBotMove(state, 0, "hard", seed)).state.winner).not.toBe(1);
      }
    });
  });

  it("stößt auf jeder Stufe gültig an", () => {
    let illegal = 0;
    for (const level of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const state = createInitialState({ seed, startingSeat: 1 });
        const { events } = applyMove(state, 1, chooseBotMove(state, 1, level, seed * 31 + 5));
        if (events.some((e) => e.kind === "rebreak" || e.kind === "foul")) illegal++;
      }
    }
    expect(illegal).toBe(0);
  }, 60_000);

  it("setzt die Weiße beim Anstoß hinter die Kopflinie und trifft das Dreieck", () => {
    const state = createInitialState({ seed: 3, startingSeat: 1 });
    const move = chooseBotMove(state, 1, "easy", 1);
    expect(move.cueBallPos!.x).toBeLessThanOrEqual(TABLE.headStringX);
    const { events } = applyMove(state, 1, move);
    expect(events.some((e) => e.kind === "foul")).toBe(false);
  });

  it("versenkt auf Stufe Schwer eine gerade liegende Kugel und bleibt am Zug", () => {
    const state = straightIn();
    const { state: after, events } = applyMove(state, 0, chooseBotMove(state, 0, "hard", 11));
    expect(events).toContainEqual({ kind: "potted", ball: 1, seat: 0 });
    expect(after.turn).toBe(0);
  });

  it("nutzt Kugel in der Hand für einen gültigen Stoß ohne Foul", () => {
    const state = { ...straightIn(), ballInHand: true };
    const move = chooseBotMove(state, 0, "hard", 5);
    expect(move.cueBallPos).toBeDefined();
    const { events } = applyMove(state, 0, move);
    expect(events.some((e) => e.kind === "foul")).toBe(false);
  });

  it("spielt eine ganze Partie mit gültigen Stößen zu Ende", () => {
    expect(playOut(["hard", "medium"], 4711).winner).not.toBeNull();
    expect(playOut(["easy", "easy"], 99).winner).not.toBeNull();
  }, 60_000);

  it("spielt aus dem Kopffeld keine Kugel an, die selbst im Kopffeld liegt", () => {
    const state = { ...straightIn(), ballInHand: true, fromKitchen: true };
    state.balls = state.balls.map((b) => (b.id === 1 ? { ...b, pos: { x: 300, y: 300 } } : b.id === 2 ? { ...b, pos: { x: 1500, y: 500 }, potted: false } : b));
    const move = chooseBotMove(state, 0, "hard", 3);
    expect(move.cueBallPos!.x).toBeLessThanOrEqual(TABLE.headStringX);
    const { events } = applyMove(state, 0, move);
    expect(events.some((e) => e.kind === "foul")).toBe(false);
  });
});
