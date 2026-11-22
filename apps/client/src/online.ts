import type { BillardEvent, BillardMove, BillardState } from "@bandenduell/billard";
import type { TableView } from "@bandenduell/protocol";
import { TableController } from "./controller";
import type { NetClient } from "./net";

const AIM_INTERVAL_MS = 66;

/** Online-Partie: Züge gehen an den Server, Stöße beider Spieler werden hier abgespielt. */
export class OnlineTable extends TableController {
  private view: TableView;
  private pendingView: TableView | null = null;
  private lastAimSent = 0;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private net: NetClient, view: TableView) {
    super(view.state as BillardState, namesOf(view), []);
    this.view = view;
    this.adopt(view.state as BillardState);
    net.onGame((msg) => {
      if (msg.t === "aim") {
        if (msg.seat !== this.view.mySeat) this.showRemoteAim(msg.angle, msg.power, msg.cuePos);
        return;
      }
      this.play(msg.before as BillardState, msg.seat, msg.move as BillardMove, () => {
        const events = msg.events as BillardEvent[];
        this.adopt(msg.after as BillardState, events.flatMap((e) => this.describe(e)));
        if (this.pendingView) {
          const next = this.pendingView;
          this.pendingView = null;
          this.update(next);
        }
      });
    });
  }

  /** Nach einer Ablehnung durch den Server wieder den Stand des Servers zeigen. */
  resync() {
    if (!this.isRolling() && this.view.state) this.adopt(this.view.state as BillardState);
  }

  dispose() {
    this.net.onGame(null);
    if (this.aimTimer) clearTimeout(this.aimTimer);
  }

  /** Neue Tischansicht vom Server. */
  update(view: TableView) {
    if (this.isRolling()) {
      this.pendingView = view;
      return;
    }
    const prev = this.view;
    this.view = view;
    this.set({ names: namesOf(view) });
    const state = view.state as BillardState | null;
    if (!state) return;
    const prevState = prev.state as BillardState | null;
    const changed =
      !prevState || prevState.shots !== state.shots || prev.status !== view.status || prevState.turn !== state.turn || prevState.ballInHand !== state.ballInHand;
    if (changed) this.adopt(state);
    else this.set({ canAct: this.mayAct(state) && this.snapshot.phase !== "over" && this.snapshot.phase !== "rolling" });
  }

  protected mayAct(state: BillardState) {
    return this.view.status === "playing" && this.view.mySeat !== null && state.turn === this.view.mySeat && state.winner === null;
  }

  protected submit(move: BillardMove) {
    this.net.send({ t: "shoot", move });
  }

  protected onAim() {
    const now = Date.now();
    const send = () => {
      this.lastAimSent = Date.now();
      this.aimTimer = null;
      const s = this.snapshot;
      this.net.send({ t: "aim", angle: s.angle, power: s.dragging || s.power > 0 ? s.power : 0, cuePos: this.cuePosForAim() });
    };
    if (now - this.lastAimSent >= AIM_INTERVAL_MS) send();
    else if (!this.aimTimer) this.aimTimer = setTimeout(send, AIM_INTERVAL_MS - (now - this.lastAimSent));
  }
}

function namesOf(view: TableView): [string, string] {
  return [view.seats[0]?.name ?? "frei", view.seats[1]?.name ?? "frei"];
}
