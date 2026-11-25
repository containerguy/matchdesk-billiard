import { eightPocket, POCKETS, TABLE, type Ball, type BillardState, type Vec } from "@bandenduell/billard";
import { Application, Container, Graphics, Matrix, RenderTexture, Sprite, Texture } from "pixi.js";
import { useEffect, useRef } from "react";
import { ballLook, initialOrientation, paintBall, roll, type Mat3 } from "./ballRoll";
import type { TableController } from "./controller";
import { HotseatGame } from "./hotseat";

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
const AMBER = 0xf2a93b;

/** Dauer der Einloch-Animation in Millisekunden. */
const SINK_MS = 320;
/** Radius der gezeichneten Taschen in Pixeln. */
const POCKET_DRAW_RADIUS = 16;

function nearestPocket(p: Vec): Vec {
  return POCKETS.reduce((best, pocket) => (Math.hypot(pocket.x - p.x, pocket.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? pocket : best));
}

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
        // Alles auf dem Tisch liegt in `world`, damit die Lupe denselben Inhalt vergrößert zeigen kann
        const world = new Container();
        const guide = new Graphics();
        const pocketMark = new Graphics();
        const placeMark = new Graphics();
        const ballLayer = new Container();
        const stick = new Graphics();
        world.addChild(drawTable(), pocketMark, placeMark, guide, ballLayer, stick);
        const loupe = createLoupe();
        app.stage.addChild(world, loupe.view);
        /** Touch: Finger liegt auf dem Tisch. */
        let fingerDown = false;
        /** Zuletzt wurde per Touch bedient: nur dann erscheint die Lupe. */
        let touchUser = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        let loupeUntil = 0;
        let lastAngle = Number.NaN;
        const sprites = new Map<number, BallSprite>();
        /** Letzte gezeichnete Position je Kugel: aus der Strecke bis zum nächsten Bild ergibt sich die Drehung. */
        const lastPos = new Map<number, Vec>();
        /** Kugeln, die gerade in eine Tasche fallen: Startpunkt, Tasche und Startzeit der Animation. */
        const sinking = new Map<number, { from: Vec; to: Vec; start: number }>();
        const wasPotted = new Map<number, boolean>();

        const render = () => {
          const snap = game.getSnapshot();
          const balls = game.currentBalls();
          for (const b of balls) {
            let sprite = sprites.get(b.id);
            if (!sprite) {
              sprite = createBall(b.id);
              sprites.set(b.id, sprite);
              ballLayer.addChild(sprite.view);
            }
            const placing = b.id === 0 && snap.phase === "placing";
            const pos = placing && snap.placingPos ? snap.placingPos : b.pos;
            // Einlochen: fällt eine Kugel während eines Stoßes, rollt sie sichtbar in die Tasche
            if (b.potted && wasPotted.get(b.id) === false && snap.phase === "rolling" && !document.hidden) {
              sinking.set(b.id, { from: { ...b.pos }, to: nearestPocket(b.pos), start: performance.now() });
            }
            if (!b.potted) sinking.delete(b.id);
            wasPotted.set(b.id, b.potted);
            // Rollen: nur während eines Stoßes und nicht bei Sprüngen (Neuaufbau, übersprungene Animation)
            const last = lastPos.get(b.id);
            if (last && !b.potted && snap.phase === "rolling" && !document.hidden) {
              const dx = pos.x - last.x;
              const dy = pos.y - last.y;
              if ((dx !== 0 || dy !== 0) && Math.hypot(dx, dy) < MAX_ROLL_STEP) sprite.turn(roll(sprite.orientation, dx, dy, TABLE.ballRadius));
            }
            lastPos.set(b.id, { ...pos });
            const sink = sinking.get(b.id);
            const t = sink ? (performance.now() - sink.start) / SINK_MS : 1;
            if (sink && t < 1 && !placing) {
              const ease = t * (2 - t);
              const v = toView({ x: sink.from.x + (sink.to.x - sink.from.x) * ease, y: sink.from.y + (sink.to.y - sink.from.y) * ease });
              sprite.view.position.set(v.x, v.y);
              sprite.view.scale.set(1 - 0.45 * ease);
              sprite.view.alpha = 1 - ease * ease;
              sprite.view.visible = true;
              continue;
            }
            if (sink) sinking.delete(b.id);
            const v = toView(pos);
            sprite.view.position.set(v.x, v.y);
            sprite.view.scale.set(1);
            sprite.view.visible = !b.potted || placing;
            sprite.view.alpha = placing ? (snap.placingValid ? 0.85 : 0.35) : 1;
          }
          // Kneipenregel: die Tasche markieren, in die der Spieler am Zug die 8 spielen muss
          pocketMark.clear();
          const target = snap.state.winner === null ? eightPocket(snap.state, snap.state.turn) : null;
          if (target !== null) {
            const v = toView(POCKETS[target]!);
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
            pocketMark.circle(v.x, v.y, POCKET_DRAW_RADIUS + 4 + 2 * pulse).stroke({ width: 3, color: AMBER, alpha: 0.6 + 0.4 * pulse });
          }
          drawGuide(guide, snap.phase === "aiming" ? snap : null, balls);
          drawStick(stick, snap.phase === "aiming" ? snap : null, balls);

          // Beim Setzen der Weißen: Fadenkreuz über den Tisch, damit die Lage auch unter dem Finger erkennbar ist
          placeMark.clear();
          if (snap.phase === "placing" && snap.placingPos && fingerDown) {
            const v = toView(snap.placingPos);
            placeMark.moveTo(RAIL, v.y).lineTo(VIEW_W - RAIL, v.y).moveTo(v.x, RAIL).lineTo(v.x, VIEW_H - RAIL);
            placeMark.stroke({ width: 1, color: snap.placingValid ? 0xffffff : 0xd9452b, alpha: 0.45 });
          }

          // Lupe: zeigt am Handy vergrößert, wohin gezielt oder gesetzt wird, solange der Finger arbeitet
          // und kurz nach jeder Feineinstellung
          const now = performance.now();
          if (snap.phase === "aiming" && snap.angle !== lastAngle && !Number.isNaN(lastAngle) && touchUser) loupeUntil = now + LOUPE_LINGER_MS;
          lastAngle = snap.phase === "aiming" ? snap.angle : Number.NaN;
          const cueBall = balls.find((b) => b.id === 0);
          const focus =
            !snap.canAct || !touchUser
              ? null
              : snap.phase === "placing" && fingerDown
                ? snap.placingPos
                : snap.phase === "aiming" && (fingerDown || now < loupeUntil)
                  ? (snap.preview?.end ?? cueBall?.pos ?? null)
                  : null;
          loupe.view.visible = focus !== null;
          el.dataset.loupe = focus !== null ? "on" : "off";
          if (focus) {
            const v = toView(focus);
            // In die Ecke, die Zielpunkt und Weiße am wenigsten verdeckt
            const keep = [v, cueBall ? toView(snap.phase === "placing" ? focus : cueBall.pos) : v];
            const corners = [RAIL + 8, VIEW_W - RAIL - 8 - LOUPE_SIZE].flatMap((x) => [RAIL + 8, VIEW_H - RAIL - 8 - LOUPE_SIZE].map((y) => ({ x, y })));
            const free = (c: { x: number; y: number }) => Math.min(...keep.map((k) => Math.hypot(k.x - c.x - LOUPE_SIZE / 2, k.y - c.y - LOUPE_SIZE / 2)));
            const corner = corners.reduce((best, c) => (free(c) > free(best) ? c : best));
            loupe.view.position.set(corner.x, corner.y);
            loupe.view.visible = false;
            app.renderer.render({
              container: world,
              target: loupe.texture,
              clear: true,
              transform: new Matrix().scale(LOUPE_ZOOM, LOUPE_ZOOM).translate(LOUPE_SIZE / 2 - v.x * LOUPE_ZOOM, LOUPE_SIZE / 2 - v.y * LOUPE_ZOOM)
            });
            loupe.view.visible = true;
          }
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
        const hooks = window as unknown as { bandenduellState?: () => unknown; bandenduellRoll?: (id: number) => unknown; bandenduellLoad?: (state: BillardState) => void; bandenduellAim?: () => unknown };
        // Stellungen aufbauen geht nur am lokalen Tisch, nie in einer Online-Partie
        hooks.bandenduellLoad = game instanceof HotseatGame ? (state) => game.loadPosition(state) : undefined;
        hooks.bandenduellState = () => game.getSnapshot().state;
        hooks.bandenduellRoll = (id) => sprites.get(id)?.orientation ?? null;
        hooks.bandenduellAim = () => {
          const { phase, angle, placingPos, placingValid } = game.getSnapshot();
          return { phase, angle, placingPos, placingValid, cue: game.currentBalls().find((b) => b.id === 0)?.pos ?? null };
        };

        const point = (ev: PointerEvent) => {
          const rect = app.canvas.getBoundingClientRect();
          return toTable(((ev.clientX - rect.left) / rect.width) * VIEW_W, ((ev.clientY - rect.top) / rect.height) * VIEW_H);
        };
        const isTouch = (ev: PointerEvent) => ev.pointerType !== "mouse";
        const onMove = (ev: PointerEvent) => game.pointerMove(point(ev), isTouch(ev));
        const onDown = (ev: PointerEvent) => {
          touchUser = isTouch(ev);
          fingerDown = touchUser;
          ev.preventDefault();
          app.canvas.setPointerCapture(ev.pointerId);
          game.pointerDown(point(ev), isTouch(ev));
        };
        const onUp = (ev: PointerEvent) => {
          fingerDown = false;
          if (isTouch(ev)) loupeUntil = performance.now() + LOUPE_LINGER_MS;
          game.pointerUp(isTouch(ev));
        };
        const onCancel = () => {
          fingerDown = false;
          game.cancelDrag();
        };
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
    g.circle(v.x, v.y, POCKET_DRAW_RADIUS).fill(0x070b0c);
    g.circle(v.x, v.y, POCKET_DRAW_RADIUS).stroke({ width: 3, color: 0x1e1610 });
  }
  return g;
}

/** Kantenlänge der Lupe und ihre Vergrößerung (in Pixeln der Zeichenfläche). */
const LOUPE_SIZE = 210;
const LOUPE_ZOOM = 2.4;
/** So lange bleibt die Lupe nach der letzten Berührung oder Feineinstellung stehen. */
const LOUPE_LINGER_MS = 1600;

/** Runde Lupe: ein Bild, in das der Tisch vergrößert gezeichnet wird, mit Rand und Mittelmarke. */
function createLoupe() {
  const texture = RenderTexture.create({ width: LOUPE_SIZE, height: LOUPE_SIZE, resolution: Math.min(2, window.devicePixelRatio || 1), antialias: true });
  const view = new Container();
  const half = LOUPE_SIZE / 2;
  const picture = new Sprite(texture);
  const mask = new Graphics().circle(half, half, half - 2).fill(0xffffff);
  picture.mask = mask;
  const frame = new Graphics();
  frame.circle(half, half, half - 2).stroke({ width: 4, color: 0x0a1416 });
  frame.circle(half, half, half - 2).stroke({ width: 2, color: AMBER, alpha: 0.9 });
  view.addChild(new Graphics().circle(half + 2, half + 4, half - 2).fill({ color: 0x000000, alpha: 0.4 }), picture, mask, frame);
  view.visible = false;
  view.eventMode = "none";
  return { view, texture };
}

type BallSprite = { view: Container; orientation: Mat3; turn: (orientation: Mat3) => void };

/** Kantenlänge des gemalten Kugelbilds in Pixeln. */
const BALL_TEXTURE = 72;
/** Größere Schritte zwischen zwei Bildern gelten als Sprung, nicht als Rollen (Tischmaß). */
const MAX_ROLL_STEP = 400;

/** Deckung der Ziffern im Nummernfeld, abgetastet aus einem vorab gemalten Bild. */
function numberGlyph(id: number): (u: number, v: number) => number {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = `700 ${id >= 10 ? 30 : 36}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(id), size / 2, size / 2 + 2);
  const alpha = ctx.getImageData(0, 0, size, size).data;
  return (u, v) => {
    const x = Math.floor(((u + 1) / 2) * size);
    const y = Math.floor(((v + 1) / 2) * size);
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    return alpha[(y * size + x) * 4 + 3]! / 255;
  };
}

/** Kugel mit Schatten. `turn` setzt die Lage und malt die Kugel neu. */
function createBall(id: number): BallSprite {
  const r = TABLE.ballRadius * S;
  const view = new Container();
  view.addChild(new Graphics().circle(1.5, 2.5, r).fill({ color: 0x000000, alpha: 0.35 }));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = BALL_TEXTURE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(BALL_TEXTURE, BALL_TEXTURE);
  const look = ballLook(id, COLORS);
  const glyph = look.numbered ? numberGlyph(id) : () => 0;
  const texture = Texture.from(canvas);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  // Das Bild hat rundum einen Pixel Rand für die geglättete Kante
  sprite.width = sprite.height = (2 * r * BALL_TEXTURE) / (BALL_TEXTURE - 2);
  view.addChild(sprite);
  const ball: BallSprite = {
    view,
    orientation: initialOrientation(id),
    turn(orientation) {
      ball.orientation = orientation;
      paintBall(image.data, BALL_TEXTURE, look, orientation, glyph);
      ctx.putImageData(image, 0, 0);
      texture.source.update();
    }
  };
  ball.turn(ball.orientation);
  return ball;
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
