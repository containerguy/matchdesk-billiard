import { describe, expect, it } from "vitest";
import { HotseatGame } from "../src/hotseat";

describe("Neue Partie", () => {
  it("wird nicht von einem noch rollenden Stoß der alten Partie überschrieben", () => {
    const game = new HotseatGame();
    game.pointerDown({ x: 400, y: 560 }, false);
    game.setPower(0.9);
    game.shootNow();
    expect(game.getSnapshot().phase).toBe("rolling");

    game.newGame();
    game.fastForward();
    game.tick(16);

    const snap = game.getSnapshot();
    expect(snap.phase).toBe("placing");
    expect(snap.state.isBreak).toBe(true);
    expect(snap.state.shots).toBe(0);
    expect(snap.log).toHaveLength(1);
  });
});
