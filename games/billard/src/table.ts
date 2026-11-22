/**
 * Tischmaße in Millimetern (Spielfläche eines 8-Fuß-Tisches).
 * Ursprung oben links, x nach rechts, y nach unten.
 */
export const TABLE = {
  width: 2240,
  height: 1120,
  ballRadius: 28.575,
  /** Länge der Öffnung an den Ecktaschen, gemessen entlang jeder Bande ab der Ecke. */
  cornerMouth: 72,
  /** Halbe Breite der Mitteltaschen-Öffnung. */
  sideMouthHalf: 54,
  /** Fangradius der Taschen um ihren Mittelpunkt. */
  pocketRadius: 52,
  /** x-Position der Kopflinie (Anstoßbereich links davon). */
  headStringX: 560
} as const;

export type Vec = { x: number; y: number };

export const POCKETS: readonly Vec[] = [
  { x: -12, y: -12 },
  { x: TABLE.width / 2, y: -30 },
  { x: TABLE.width + 12, y: -12 },
  { x: -12, y: TABLE.height + 12 },
  { x: TABLE.width / 2, y: TABLE.height + 30 },
  { x: TABLE.width + 12, y: TABLE.height + 12 }
];

/** Startpunkt der weißen Kugel und Fußpunkt des Dreiecks. */
export const HEAD_SPOT: Vec = { x: TABLE.headStringX, y: TABLE.height / 2 };
export const FOOT_SPOT: Vec = { x: TABLE.width * 0.75, y: TABLE.height / 2 };

export const vec = {
  add: (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s }),
  dot: (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y,
  len: (a: Vec): number => Math.hypot(a.x, a.y),
  dist: (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y),
  norm: (a: Vec): Vec => {
    const l = Math.hypot(a.x, a.y);
    return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
  },
  fromAngle: (angle: number): Vec => ({ x: Math.cos(angle), y: Math.sin(angle) })
};
