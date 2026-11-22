import { POCKETS, TABLE, type Ball, type Vec } from "@bandenduell/billard";
import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import type { TableController } from "./controller";

/** Darstellung: Tuch 880 × 440 px, Bande 40 px, Gesamtfläche 960 × 520 px. */
const RAIL = 40;
const CLOTH_W = 880;
const S = CLOTH_W / TABLE.width;
const VIEW_W = CLOTH_W + 2 * RAIL;
const VIEW_H = TABLE.height * S + 2 * RAIL;

const COLORS: Record<number, number> = {
  1: 0xf2c230,
  2: 0x2f6fd6,
  3: 0xd9452b,
  4: 0x7a4bc2,
  5: 0xee7a22,
  6: 0x2e9a5a,
  7: 0x8e2b34,
  8: 0x15171a
};
const IVORY = 0xf4f1ea;
const AMBER = 0xf2a93b;

const toView = (p: Vec) => ({ x: RAIL + p.x * S, y: RAIL + p.y * S });
const toTable = (x: number, y: number): Vec => ({ x: (x - RAIL) / S, y: (y - RAIL) / S });

export function TableView({ game }: { game: TableController }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const app = new Application();
    let disposed = false;
    let cleanup = () => {};

    app
      .init({ width: VIEW_W, height: VIEW_H, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        el.appendChild(app.canvas);
        app.stage.addChild(drawTable());
        const guide = new Graphics();
        const ballLayer = new Container();
        const stick = new Graphics();
        app.stage.addChild(guide, ballLayer, stick);
        const sprites = new Map<number, Container>();

        const render = () => {
          const snap = game.getSnapshot();
          const balls = game.currentBalls();
          for (const b of balls) {
            let sprite = sprites.get(b.id);
            if (!sprite) {
              sprite = drawBall(b.id);
              sprites.set(b.id, sprite);
              ballLayer.addChild(sprite);
            }
            const placing = b.id === 0 && snap.phase === "placing";
            const pos = placing && snap.placingPos ? snap.placingPos : b.pos;
            const v = toView(pos);
            sprite.position.set(v.x, v.y);
            sprite.visible = !b.potted || placing;
            sprite.alpha = placing ? (snap.placingValid ? 0.85 : 0.35) : 1;
          }
          drawGuide(guide, snap.phase === "aiming" ? snap : null, balls);
          drawStick(stick, snap.phase === "aiming" ? snap : null, balls);
        };

        app.ticker.add((ticker) => {
          game.tick(ticker.deltaMS);
          render();
        });
        const onHidden = () => {
          if (document.hidden) game.fastForward();
        };
        document.addEventListener("visibilitychange", onHidden);
        // Lesender Zugriff auf den sichtbaren Spielstand, für Fehlersuche und End-to-End-Tests
        (window as unknown as { bandenduellState?: () => unknown }).bandenduellState = () => game.getSnapshot().state;

        const point = (ev: PointerEvent) => {
          const rect = app.canvas.getBoundingClientRect();
          return toTable(((ev.clientX - rect.left) / rect.width) * VIEW_W, ((ev.clientY - rect.top) / rect.height) * VIEW_H);
        };
        const isTouch = (ev: PointerEvent) => ev.pointerType !== "mouse";
        const onMove = (ev: PointerEvent) => game.pointerMove(point(ev), isTouch(ev));
        const onDown = (ev: PointerEvent) => {
          ev.preventDefault();
          app.canvas.setPointerCapture(ev.pointerId);
          game.pointerDown(point(ev), isTouch(ev));
        };
        const onUp = (ev: PointerEvent) => game.pointerUp(isTouch(ev));
        const onCancel = () => game.cancelDrag();
        app.canvas.addEventListener("pointermove", onMove);
        app.canvas.addEventListener("pointerdown", onDown);
        app.canvas.addEventListener("pointerup", onUp);
        app.canvas.addEventListener("pointercancel", onCancel);
        app.canvas.style.touchAction = "none";
        app.canvas.style.width = "100%";
        app.canvas.style.height = "auto";
        cleanup = () => {
          app.canvas.removeEventListener("pointermove", onMove);
          app.canvas.removeEventListener("pointerdown", onDown);
          app.canvas.removeEventListener("pointerup", onUp);
          app.canvas.removeEventListener("pointercancel", onCancel);
          document.removeEventListener("visibilitychange", onHidden);
        };
      });

    return () => {
      disposed = true;
      cleanup();
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, [game]);

  return (
    <div
      ref={host}
      className="table-view"
      role="img"
      aria-label="Billardtisch in Draufsicht. Maus bewegen zum Zielen, Maustaste halten und ziehen für die Stoßstärke, loslassen zum Stoßen."
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    />
  );
}

function drawTable() {
  const g = new Graphics();
  g.roundRect(0, 0, VIEW_W, VIEW_H, 28).fill(0x3a2a20);
  g.roundRect(2, 2, VIEW_W - 4, VIEW_H - 4, 26).stroke({ width: 2, color: 0x4a372b });
  g.roundRect(RAIL, RAIL, CLOTH_W, TABLE.height * S, 6).fill(0x11605d);
  g.roundRect(RAIL, RAIL, CLOTH_W, TABLE.height * S, 6).stroke({ width: 4, color: 0x0b4a48, alignment: 1 });
  // Kopflinie
  const hx = RAIL + TABLE.headStringX * S;
  g.moveTo(hx, RAIL).lineTo(hx, RAIL + TABLE.height * S).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
  // Diamanten
  for (const k of [1, 2, 3, 5, 6, 7]) {
    const x = RAIL + (CLOTH_W * k) / 8;
    g.circle(x, RAIL / 2, 3).fill(0xd9cbb0);
    g.circle(x, VIEW_H - RAIL / 2, 3).fill(0xd9cbb0);
  }
  for (const k of [1, 2, 3]) {
    const y = RAIL + (TABLE.height * S * k) / 4;
    g.circle(RAIL / 2, y, 3).fill(0xd9cbb0);
    g.circle(VIEW_W - RAIL / 2, y, 3).fill(0xd9cbb0);
  }
  for (const p of POCKETS) {
    const v = toView(p);
    g.circle(v.x, v.y, 20).fill(0x070b0c);
    g.circle(v.x, v.y, 20).stroke({ width: 3, color: 0x1e1610 });
  }
  return g;
}

function drawBall(id: number) {
  const r = TABLE.ballRadius * S;
  const c = new Container();
  const g = new Graphics();
  g.circle(1.5, 2.5, r).fill({ color: 0x000000, alpha: 0.35 });
  if (id === 0) {
    g.circle(0, 0, r).fill(IVORY);
  } else if (id <= 8) {
    g.circle(0, 0, r).fill(COLORS[id]!);
  } else {
    g.circle(0, 0, r).fill(IVORY);
    const a = Math.asin(0.55);
    const pts: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = -a + (2 * a * i) / 12;
      pts.push(r * Math.cos(t), r * Math.sin(t));
    }
    for (let i = 0; i <= 12; i++) {
      const t = Math.PI - a + (2 * a * i) / 12;
      pts.push(r * Math.cos(t), r * Math.sin(t));
    }
    // Waagerechtes Farbband: rechter und linker Kreisbogen, verbunden
    g.poly(pts).fill(COLORS[id - 8]!);
  }
  if (id !== 0) {
    g.circle(0, 0, r * 0.5).fill(IVORY);
  }
  g.circle(-r * 0.35, -r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.3 });
  c.addChild(g);
  if (id !== 0) {
    const t = new Text({ text: String(id), style: { fontFamily: "Inter, sans-serif", fontSize: 8, fontWeight: "700", fill: 0x15171a } });
    t.anchor.set(0.5);
    t.resolution = 3;
    c.addChild(t);
  }
  return c;
}

type AimSnap = { angle: number; power: number; dragging: boolean; guide: "normal" | "profi"; preview: { end: Vec; target: { pos: Vec; dir: Vec } | null; cueDir: Vec | null } | null };

function dashed(g: Graphics, from: Vec, to: Vec, dash: number, gap: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(from.x + ux * d, from.y + uy * d).lineTo(from.x + ux * e, from.y + uy * e);
  }
}

function drawGuide(g: Graphics, snap: AimSnap | null, balls: readonly Ball[]) {
  g.clear();
  const cue = balls.find((b) => b.id === 0 && !b.potted);
  if (!snap || !snap.preview || !cue) return;
  const from = toView(cue.pos);
  const end = toView(snap.preview.end);
  dashed(g, from, end, 7, 5);
  g.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
  const r = TABLE.ballRadius * S;
  if (snap.preview.target) {
    g.circle(end.x, end.y, r).stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 });
    if (snap.guide === "normal") {
      const t = toView(snap.preview.target.pos);
      const d = snap.preview.target.dir;
      g.moveTo(t.x, t.y).lineTo(t.x + d.x * 80, t.y + d.y * 80).stroke({ width: 2, color: AMBER });
      if (snap.preview.cueDir) {
        const c = snap.preview.cueDir;
        dashed(g, end, { x: end.x + c.x * 50, y: end.y + c.y * 50 }, 5, 4);
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
      }
    }
  }
}

function drawStick(g: Graphics, snap: AimSnap | null, balls: readonly Ball[]) {
  g.clear();
  const cue = balls.find((b) => b.id === 0 && !b.potted);
  if (!snap || !cue) return;
  const c = toView(cue.pos);
  const back = { x: -Math.cos(snap.angle), y: -Math.sin(snap.angle) };
  const offset = TABLE.ballRadius * S + 4 + (snap.dragging ? snap.power * 70 : 0);
  const at = (d: number) => ({ x: c.x + back.x * d, y: c.y + back.y * d });
  const tip = at(offset);
  const tipEnd = at(offset + 5);
  const ferrule = at(offset + 112);
  const butt = at(offset + 330);
  g.moveTo(tip.x + 3, tip.y + 5).lineTo(butt.x + 3, butt.y + 5).stroke({ width: 8, color: 0x000000, alpha: 0.3, cap: "round" });
  g.moveTo(ferrule.x, ferrule.y).lineTo(butt.x, butt.y).stroke({ width: 8, color: 0x5e3a20, cap: "round" });
  g.moveTo(tipEnd.x, tipEnd.y).lineTo(ferrule.x, ferrule.y).stroke({ width: 7, color: 0xefe6d2 });
  g.moveTo(tip.x, tip.y).lineTo(tipEnd.x, tipEnd.y).stroke({ width: 7, color: 0x4c7fbf });
}
