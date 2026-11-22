import { groupCleared, groupOf, type Group } from "@spielhalle/billard";
import type { Seat } from "@spielhalle/core";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { HotseatGame, type Snapshot } from "./hotseat";
import { TableView } from "./TableView";

const BALL_COLORS: Record<number, string> = {
  1: "#F2C230",
  2: "#2F6FD6",
  3: "#D9452B",
  4: "#7A4BC2",
  5: "#EE7A22",
  6: "#2E9A5A",
  7: "#8E2B34",
  8: "#15171A"
};

export function App() {
  const game = useMemo(() => new HotseatGame(["Spieler 1", "Spieler 2"]), []);
  const snap = useSyncExternalStore(game.subscribe, game.getSnapshot);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="12" fill="#F2A93B" />
            <circle cx="14" cy="14" r="5.5" fill="#121E22" />
            <circle cx="14" cy="14" r="2.5" fill="#F2A93B" />
          </svg>
          <span>Bandenduell</span>
        </div>
        <div className="match-info">
          <strong>8-Ball</strong>
          <span aria-hidden="true">·</span>
          <span>Lokale Partie an einem Rechner</span>
        </div>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => game.newGame()}>
            Neue Partie
          </button>
        </div>
      </header>

      <div className="body">
        <main className="play">
          <div className="players">
            <PlayerCard snap={snap} seat={0} />
            <div className="score">
              <span>Stoß {snap.state.shots + (snap.phase === "rolling" ? 1 : 0)}</span>
            </div>
            <PlayerCard snap={snap} seat={1} />
          </div>
          <TableView game={game} />
          <Controls game={game} snap={snap} />
        </main>
        <aside className="side">
          <div className="side-head">
            <h2>Spielverlauf</h2>
          </div>
          <ol className="log" aria-live="polite">
            {snap.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          <p className="side-note">Chat und Lobby kommen mit der Online-Partie.</p>
        </aside>
      </div>
    </div>
  );
}

function PlayerCard({ snap, seat }: { snap: Snapshot; seat: Seat }) {
  const { state, phase, names } = snap;
  const group = state.groups[seat];
  const active = state.turn === seat && phase !== "over";
  const won = state.winner === seat;
  const status = won ? "Gewonnen" : active ? (phase === "placing" ? "Kugel in der Hand" : "Am Zug") : state.winner !== null ? "Verloren" : "wartet";
  const ids = group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : group === "stripes" ? [9, 10, 11, 12, 13, 14, 15] : [];
  const onEight = group !== null && groupCleared(state.balls, group);
  return (
    <div className={`player ${seat === 1 ? "right" : ""} ${active || won ? "active" : ""}`}>
      <div className="avatar" style={{ background: seat === 0 ? "#F2A93B" : "#3B7DD8", color: seat === 0 ? "#1B1206" : "#FFFFFF" }}>
        {names[seat].slice(-1)}
      </div>
      <div className="player-body">
        <div className="player-row">
          <span className="name">{names[seat]}</span>
          <span className={`badge ${active || won ? "on" : ""}`}>{status}</span>
        </div>
        <div className="player-row balls">
          <span className="group">{groupLabel(group)}</span>
          {ids.map((id) => {
            const potted = state.balls.find((b) => b.id === id)?.potted ?? false;
            return <MiniBall key={id} id={id} faded={potted} />;
          })}
          {onEight && <MiniBall id={8} faded={false} />}
        </div>
      </div>
    </div>
  );
}

function groupLabel(g: Group | null) {
  return g === "solids" ? "Volle" : g === "stripes" ? "Halbe" : "Gruppe offen";
}

function MiniBall({ id, faded }: { id: number; faded: boolean }) {
  const stripe = groupOf(id) === "stripes";
  const color = BALL_COLORS[stripe ? id - 8 : id]!;
  const background = stripe ? `linear-gradient(180deg, #F4F1EA 0 27%, ${color} 27% 73%, #F4F1EA 73%)` : color;
  return (
    <span className="mini-ball" style={{ background, opacity: faded ? 0.25 : 1 }} aria-label={`Kugel ${id}${faded ? ", versenkt" : ""}`}>
      <span>{id}</span>
    </span>
  );
}

function Controls({ game, snap }: { game: HotseatGame; snap: Snapshot }) {
  const pad = useRef<HTMLButtonElement>(null);
  const pickSpin = (ev: React.MouseEvent<HTMLButtonElement>) => {
    const rect = pad.current!.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((ev.clientY - rect.top) / rect.height) * 2 - 1;
    game.setSpin({ x, y });
  };
  const spinText =
    snap.spin.y > 0.25 ? "Rücklauf" : snap.spin.y < -0.25 ? "Vorlauf" : Math.abs(snap.spin.x) > 0.25 ? (snap.spin.x > 0 ? "Rechtseffet" : "Linkseffet") : "Mitte";
  const hint =
    snap.phase === "placing"
      ? snap.state.isBreak
        ? "Weiße Kugel links der Kopflinie setzen (Klick)"
        : "Kugel in der Hand: weiße Kugel frei setzen (Klick)"
      : snap.phase === "rolling"
        ? "Kugeln rollen …"
        : snap.phase === "over"
          ? "Partie vorbei. Neue Partie oben rechts."
          : "Maus bewegen zum Zielen · Maustaste halten, zurückziehen, loslassen";
  return (
    <div className="controls">
      <div className="power">
        <div className="power-head">
          <span>Stoßstärke</span>
          <strong>{Math.round(snap.power * 100)} %</strong>
        </div>
        <div className="power-bar" role="meter" aria-label="Stoßstärke" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.power * 100)}>
          <div style={{ width: `${snap.power * 100}%` }} />
        </div>
      </div>
      <div className="spin">
        <button ref={pad} type="button" className="spin-pad" onClick={pickSpin} aria-label={`Effet wählen, aktuell ${spinText}`}>
          <span className="spin-dot" style={{ left: `${50 + snap.spin.x * 40}%`, top: `${50 + snap.spin.y * 40}%` }} />
        </button>
        <div className="spin-text">
          <span>Effet</span>
          <strong>{spinText}</strong>
        </div>
      </div>
      <div className="guide">
        <div className="segmented" role="group" aria-label="Zielhilfe">
          <button type="button" aria-pressed={snap.guide === "normal"} onClick={() => game.setGuide("normal")}>
            Zielhilfe normal
          </button>
          <button type="button" aria-pressed={snap.guide === "profi"} onClick={() => game.setGuide("profi")}>
            Profi
          </button>
        </div>
        <span className="hint">{hint}</span>
      </div>
    </div>
  );
}
