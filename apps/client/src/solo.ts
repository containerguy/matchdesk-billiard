import { aimPreview, chooseBotMove, type BillardMove, type BillardState, type BotLevel } from "@bandenduell/billard";
import { HotseatGame } from "./hotseat";

export const BOT_LEVELS: ReadonlyArray<{ id: BotLevel; label: string }> = [
  { id: "easy", label: "Leicht" },
  { id: "medium", label: "Mittel" },
  { id: "hard", label: "Schwer" }
];

const BOT_SEAT = 1;
const THINK_MS = 700;
const PLACE_MS = 600;
const AIM_MS = 800;
const PULL_MS = 350;

/** Solo-Partie: der Mensch sitzt auf Platz 1, der Computer auf Platz 2. */
export class SoloGame extends HotseatGame {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(playerName: string, private level: BotLevel) {
    super([playerName, `Computer (${BOT_LEVELS.find((l) => l.id === level)!.label})`]);
  }

  newGame() {
    this.cancel();
    super.newGame();
  }

  dispose() {
    this.cancel();
  }

  protected mayAct(state: BillardState) {
    return state.turn !== BOT_SEAT;
  }

  protected adopt(state: BillardState, extraLog: string[] = []) {
    super.adopt(state, extraLog);
    if (state.turn === BOT_SEAT && state.winner === null) this.botTurn(state);
  }

  private cancel() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Führt nacheinander aus, solange keine neue Partie begonnen hat. */
  private later(ms: number, task: () => void) {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) task();
    }, ms);
  }

  private botTurn(state: BillardState) {
    this.later(THINK_MS, () => {
      const move = chooseBotMove(state, BOT_SEAT, this.level, (Date.now() ^ (state.shots * 7919)) >>> 0);
      const aim = () => {
        this.showBotAim(move, 0);
        this.later(AIM_MS, () => {
          this.showBotAim(move, move.shot.power);
          this.later(PULL_MS, () => this.submit(move));
        });
      };
      if (!move.cueBallPos) return aim();
      this.set({ phase: "placing", placingPos: move.cueBallPos, placingValid: true });
      this.later(PLACE_MS, aim);
    });
  }

  private showBotAim(move: BillardMove, power: number) {
    if (move.cueBallPos) this.placedCue = { ...move.cueBallPos };
    this.set({
      phase: "aiming",
      placingPos: null,
      angle: move.shot.angle,
      power,
      dragging: power > 0,
      preview: aimPreview(this.currentBalls(), move.shot.angle)
    });
  }
}
