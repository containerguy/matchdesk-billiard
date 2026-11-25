/**
 * Rollende Kugeln: Jede Kugel hat eine Lage im Raum (Drehmatrix). Aus der Strecke, die sie
 * zwischen zwei Bildern zurücklegt, ergibt sich die Drehung; daraus wird die Kugel als
 * beleuchtete Kugel mit Streifen und Nummernfeldern gemalt.
 *
 * Koordinaten: x nach rechts, y nach unten (wie der Tisch), z zum Betrachter.
 */

/** Drehmatrix, zeilenweise. Sie bildet Kugelkoordinaten auf Sichtkoordinaten ab. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Farbe als [r, g, b] mit Werten von 0 bis 255. */
export type Rgb = readonly [number, number, number];

export type BallLook = {
  /** Grundfarbe; bei der Weißen und bei halben Kugeln Elfenbein. */
  base: Rgb;
  /** Farbband der halben Kugeln. */
  stripe: Rgb | null;
  /** Nummernfelder auf zwei gegenüberliegenden Seiten. */
  numbered: boolean;
  /** Kleine Markierungspunkte der Weißen, damit ihr Rollen sichtbar ist. */
  dots: Rgb | null;
};

/** Halbe Breite des Farbbands, als Anteil des Radius. */
export const STRIPE_HALF_WIDTH = 0.55;
/** Radius des Nummernfelds, als Anteil des Radius. */
export const DISC_RADIUS = 0.5;
const DISC_COS = Math.sqrt(1 - DISC_RADIUS * DISC_RADIUS);
const DOT_COS = Math.cos(0.2);
const IVORY: Rgb = [244, 241, 234];
const INK: Rgb = [21, 23, 26];
/** Richtung zum Licht (links oben vor dem Tisch). */
const LIGHT = normalize([-0.42, -0.5, 0.76]);
/** Markierungspunkte der Weißen: die sechs Achsenrichtungen. */
const DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = identity();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out;
}

/** Drehung um eine Achse (Einheitsvektor) um den Winkel `angle`. */
function axisRotation(x: number, y: number, z: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** Gleicht Rundungsfehler aus, damit die Matrix eine reine Drehung bleibt. */
function orthonormalize(m: Mat3): Mat3 {
  const a = normalize([m[0], m[3], m[6]]);
  const dot = a[0] * m[1] + a[1] * m[4] + a[2] * m[7];
  const b = normalize([m[1] - dot * a[0], m[4] - dot * a[1], m[7] - dot * a[2]]);
  const c: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

/**
 * Lage nach dem Rollen um (dx, dy) auf dem Tisch. Die Kugel rollt ohne zu rutschen:
 * ihr oberster Punkt wandert in Fahrtrichtung, der Winkel ist Strecke durch Radius.
 */
export function roll(m: Mat3, dx: number, dy: number, radius: number): Mat3 {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return m;
  return orthonormalize(multiply(axisRotation(-dy / distance, dx / distance, 0, distance / radius), m));
}

/** Ausgangslage: Nummer nach oben, um die Hochachse je Kugel anders gedreht. */
export function initialOrientation(id: number): Mat3 {
  return axisRotation(0, 0, 1, id * 2.399963);
}

export function ballLook(id: number, colors: Record<number, number>): BallLook {
  const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  if (id === 0) return { base: IVORY, stripe: null, numbered: false, dots: [200, 52, 44] };
  if (id <= 8) return { base: rgb(colors[id]!), stripe: null, numbered: true, dots: null };
  return { base: IVORY, stripe: rgb(colors[id - 8]!), numbered: true, dots: null };
}

const smooth = (edge: number, width: number, value: number) => Math.min(1, Math.max(0, (value - edge) / width + 0.5));

/**
 * Malt die Kugel in ein quadratisches RGBA-Bild der Kantenlänge `size`.
 * `glyph` liefert die Deckung der Ziffern im Nummernfeld für (u, v) aus [-1, 1].
 */
export function paintBall(data: Uint8ClampedArray, size: number, look: BallLook, m: Mat3, glyph: (u: number, v: number) => number) {
  const half = size / 2;
  const radius = half - 1;
  const soft = 1.5 / radius;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      const x = (px + 0.5 - half) / radius;
      const y = (py + 0.5 - half) / radius;
      const d2 = x * x + y * y;
      const edge = (1 - Math.sqrt(d2)) * radius;
      if (edge <= -0.5) {
        data[o + 3] = 0;
        continue;
      }
      const z = Math.sqrt(Math.max(0, 1 - d2));
      // Punkt in Kugelkoordinaten: Transponierte der Drehmatrix
      const qx = m[0] * x + m[3] * y + m[6] * z;
      const qy = m[1] * x + m[4] * y + m[7] * z;
      const qz = m[2] * x + m[5] * y + m[8] * z;

      let r = look.base[0];
      let g = look.base[1];
      let b = look.base[2];
      if (look.stripe) {
        const k = 1 - smooth(STRIPE_HALF_WIDTH, soft, Math.abs(qx));
        r += (look.stripe[0] - r) * k;
        g += (look.stripe[1] - g) * k;
        b += (look.stripe[2] - b) * k;
      }
      if (look.numbered) {
        const k = smooth(DISC_COS, soft * 0.6, Math.abs(qz));
        if (k > 0) {
          // Auf der Rückseite gespiegelt, damit die Ziffer dort nicht seitenverkehrt steht
          const ink = glyph(((qz > 0 ? qx : -qx) / DISC_RADIUS) * 1.05, (qy / DISC_RADIUS) * 1.05);
          r += (IVORY[0] + (INK[0] - IVORY[0]) * ink - r) * k;
          g += (IVORY[1] + (INK[1] - IVORY[1]) * ink - g) * k;
          b += (IVORY[2] + (INK[2] - IVORY[2]) * ink - b) * k;
        }
      }
      if (look.dots) {
        let best = 0;
        for (const dot of DOTS) best = Math.max(best, qx * dot[0] + qy * dot[1] + qz * dot[2]);
        const k = smooth(DOT_COS, soft * 0.4, best);
        r += (look.dots[0] - r) * k;
        g += (look.dots[1] - g) * k;
        b += (look.dots[2] - b) * k;
      }

      // Licht: zum Rand hin dunkler, dazu ein Glanzpunkt, der mit der Kugel nicht mitrollt
      const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
      const shade = 0.62 + 0.38 * diffuse;
      const gloss = Math.pow(diffuse, 40) * 150;
      data[o] = r * shade + gloss;
      data[o + 1] = g * shade + gloss;
      data[o + 2] = b * shade + gloss;
      data[o + 3] = 255 * Math.min(1, edge + 0.5);
    }
  }
}
