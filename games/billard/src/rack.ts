import type { Ball } from "./physics";
import { FOOT_SPOT, HEAD_SPOT, TABLE } from "./table";

/** Kleiner deterministischer Zufallsgenerator (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Baut das Dreieck für 8-Ball auf: Spitze auf dem Fußpunkt, die 8 in der Mitte,
 * in den hinteren Ecken eine volle und eine halbe Kugel, der Rest gemischt.
 */
export function rack8Ball(seed: number): Ball[] {
  const rnd = random(seed);
  const r = TABLE.ballRadius;
  const gap = 0.2; // Millimeter Luft, damit keine Kugel überlappt
  const dx = Math.sqrt(3) * (r + gap);
  const slots: { x: number; y: number }[] = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      slots.push({ x: FOOT_SPOT.x + row * dx, y: FOOT_SPOT.y + (k - row / 2) * 2 * (r + gap) });
    }
  }
  // Slot 4 = Mitte der dritten Reihe; 10 und 14 = hintere Ecken
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  shuffle(rest, rnd);
  const cornerSolid = rest.splice(rest.findIndex((n) => n < 8), 1)[0]!;
  const cornerStripe = rest.splice(rest.findIndex((n) => n > 8), 1)[0]!;
  const corners = rnd() < 0.5 ? [cornerSolid, cornerStripe] : [cornerStripe, cornerSolid];
  const order: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (i === 4) order.push(8);
    else if (i === 10) order.push(corners[0]!);
    else if (i === 14) order.push(corners[1]!);
    else order.push(rest.shift()!);
  }
  const balls: Ball[] = [{ id: 0, pos: { ...HEAD_SPOT }, vel: { x: 0, y: 0 }, potted: false }];
  order.forEach((id, i) => balls.push({ id, pos: { ...slots[i]! }, vel: { x: 0, y: 0 }, potted: false }));
  return balls;
}

function shuffle<T>(list: T[], rnd: () => number) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}
