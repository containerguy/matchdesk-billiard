import { billard, type BillardMove, type BillardState } from "@bandenduell/billard";
import { describe, expect, it } from "vitest";
import { TableController } from "../src/controller";

/** Tisch ohne Netz und ohne Zeichnen: nur die Bedienlogik. */
class TestTable extends TableController {
  moves: BillardMove[] = [];
  constructor() {
    const state = billard.createInitialState({ seed: 1, startingSeat: 0 });
    super(state, ["A", "B"], []);
    this.adopt(state);
  }
  /** Die Uhr steht still, bis ein Test sie weiterdreht. */
  time = 0;
  protected override clock = () => this.time;
  wait(ms: number) {
    this.time += ms;
  }
  protected mayAct(_state: BillardState) {
    return true;
  }
  protected submit(move: BillardMove) {
    this.moves.push(move);
  }
}

const deg = (rad: number) => (rad * 180) / Math.PI;

function placed() {
  const table = new TestTable();
  table.pointerDown({ x: 300, y: 300 }, true);
  table.pointerMove({ x: 400, y: 560 }, true);
  table.pointerUp(true);
  return table;
}

describe("Touchsteuerung", () => {
  it("setzt die Weiße erst beim Loslassen, dort wo der Finger zuletzt war", () => {
    const table = new TestTable();
    table.pointerDown({ x: 300, y: 300 }, true);
    expect(table.getSnapshot()).toMatchObject({ phase: "placing", placingPos: { x: 300, y: 300 }, placingValid: true });
    table.pointerMove({ x: 400, y: 560 }, true);
    expect(table.getSnapshot().phase).toBe("placing");
    table.pointerUp(true);
    expect(table.getSnapshot().phase).toBe("aiming");
    expect(table.currentBalls().find((b) => b.id === 0)!.pos).toEqual({ x: 400, y: 560 });
  });

  it("setzt die Weiße nicht an einer ungültigen Stelle", () => {
    const table = new TestTable();
    table.pointerDown({ x: 300, y: 300 }, true);
    table.pointerMove({ x: 1500, y: 560 }, true);
    table.pointerUp(true);
    expect(table.getSnapshot()).toMatchObject({ phase: "placing", placingValid: false });
  });

  it("zielt beim Tippen direkt auf den Punkt", () => {
    const table = placed();
    table.pointerDown({ x: 400, y: 1000 }, true);
    table.pointerUp(true);
    expect(deg(table.getSnapshot().angle)).toBeCloseTo(90, 5);
  });

  it("dreht beim Wischen weiter, ohne zum Finger zu springen", () => {
    const table = placed();
    const before = table.getSnapshot().angle;
    expect(deg(before)).toBeCloseTo(0, 5);
    // Finger setzt weit rechts der Weißen auf: die Zielrichtung bleibt zunächst
    table.pointerDown({ x: 1400, y: 560 }, true);
    table.pointerMove({ x: 1400, y: 580 }, true);
    expect(table.getSnapshot().angle).toBe(before);
    // Wischen um die Weiße herum dreht um genau den überstrichenen Winkel
    table.pointerMove({ x: 1400, y: 660 }, true);
    table.pointerMove({ x: 1400, y: 1000 }, true);
    table.pointerUp(true);
    const swept = Math.atan2(440, 1000) - Math.atan2(100, 1000);
    expect(deg(table.getSnapshot().angle - before)).toBeCloseTo(deg(swept), 5);
  });

  it("dreht nahe an der Weißen langsamer als der Finger", () => {
    const table = placed();
    table.pointerDown({ x: 400, y: 760 }, true);
    table.pointerMove({ x: 480, y: 760 }, true);
    table.pointerMove({ x: 600, y: 760 }, true);
    table.pointerUp(true);
    const swept = Math.abs(Math.atan2(200, 200) - Math.atan2(200, 80));
    const turned = Math.abs(table.getSnapshot().angle);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(swept * 0.5);
  });

  it("stellt mit den Knöpfen in kleinen Schritten nach", () => {
    const table = placed();
    table.nudgeAim(0.15);
    table.nudgeAim(0.15);
    expect(deg(table.getSnapshot().angle)).toBeCloseTo(0.3, 5);
  });

  it("lässt die gesetzte Weiße noch einmal verschieben und behält die Zielrichtung", () => {
    const table = placed();
    table.nudgeAim(20);
    table.pointerDown({ x: 410, y: 570 }, true);
    expect(table.getSnapshot().phase).toBe("placing");
    table.pointerMove({ x: 300, y: 700 }, true);
    table.pointerUp(true);
    expect(table.getSnapshot().phase).toBe("aiming");
    expect(table.currentBalls().find((b) => b.id === 0)!.pos).toEqual({ x: 300, y: 700 });
    expect(deg(table.getSnapshot().angle)).toBeCloseTo(20, 5);
  });

  it("stößt nach dem Setzen per Finger mit der gesetzten Weißen", () => {
    const table = placed();
    table.setPower(0.8);
    table.shootNow();
    expect(table.moves).toEqual([{ shot: { angle: 0, power: 0.8, spin: { x: 0, y: 0 } }, cueBallPos: { x: 400, y: 560 } }]);
  });

  describe("Abheben des Fingers", () => {
    /** Wischt in ruhigen Schritten um die Weiße und hält dann still. */
    function swiped() {
      const table = placed();
      table.pointerDown({ x: 1400, y: 560 }, true);
      for (const y of [660, 760, 860]) {
        table.wait(60);
        table.pointerMove({ x: 1400, y }, true);
      }
      return table;
    }

    it("verstellt das Ziel nicht, wenn der Finger beim Abheben noch etwas rollt", () => {
      const table = swiped();
      const aimed = table.getSnapshot().angle;
      table.wait(400);
      // Der Finger rollt beim Abheben ein paar Pixel weiter
      for (const y of [868, 880, 895]) {
        table.wait(20);
        table.pointerMove({ x: 1404, y }, true);
      }
      expect(table.getSnapshot().angle).not.toBe(aimed);
      table.wait(10);
      table.pointerUp(true);
      expect(table.getSnapshot().angle).toBe(aimed);
      expect(table.getSnapshot().preview).not.toBeNull();
    });

    it("übernimmt eine zügige Bewegung bis zum Loslassen", () => {
      const table = swiped();
      table.wait(30);
      table.pointerMove({ x: 1400, y: 1000 }, true);
      const aimed = table.getSnapshot().angle;
      table.wait(10);
      table.pointerUp(true);
      expect(table.getSnapshot().angle).toBe(aimed);
    });

    it("setzt die Weiße dort, wo der Finger vor dem Abheben lag", () => {
      const table = new TestTable();
      table.pointerDown({ x: 300, y: 300 }, true);
      table.wait(200);
      table.pointerMove({ x: 400, y: 560 }, true);
      table.wait(400);
      table.pointerMove({ x: 404, y: 572 }, true);
      table.wait(20);
      table.pointerMove({ x: 409, y: 590 }, true);
      table.wait(10);
      table.pointerUp(true);
      expect(table.currentBalls().find((b) => b.id === 0)!.pos).toEqual({ x: 400, y: 560 });
    });
  });
});
