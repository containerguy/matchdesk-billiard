import { billard, judgeShot, type BillardMove, type BillardState } from "@bandenduell/billard";
import { TableController } from "./controller";

/** Übungspartie an einem Gerät: beide Spieler stoßen abwechselnd hier. */
export class HotseatGame extends TableController {
  constructor(names: [string, string] = ["Spieler 1", "Spieler 2"]) {
    const state = billard.createInitialState({ seed: Date.now() % 2 ** 31, startingSeat: 0 });
    super(state, names, [`${names[0]} hat den Anstoß. Weiße Kugel links der Kopflinie setzen.`]);
    this.adopt(state);
  }

  newGame() {
    const state = billard.createInitialState({ seed: Date.now() % 2 ** 31, startingSeat: 0 });
    this.set({ log: [`Neue Partie. ${this.snapshot.names[0]} hat den Anstoß.`] });
    this.adopt(state);
  }

  protected mayAct() {
    return true;
  }

  protected submit(move: BillardMove) {
    const before = this.snapshot.state;
    const check = billard.checkMove(before, before.turn, move);
    if (!check.ok) {
      this.log([check.reason]);
      this.adopt(before);
      return;
    }
    this.play(before, before.turn, move, (balls, physics) => {
      const placed: BillardState = { ...before, balls: before.balls };
      const cueBefore = move.cueBallPos ? { ...placed, balls: placed.balls.map((b) => (b.id === 0 ? { ...b, pos: move.cueBallPos!, potted: false } : b)) } : placed;
      const { state, events } = judgeShot(cueBefore, before.turn, balls, physics);
      this.adopt(state, events.flatMap((e) => this.describe(e)));
    });
  }
}
