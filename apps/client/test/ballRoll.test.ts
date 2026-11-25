import { describe, expect, it } from "vitest";
import { ballLook, identity, initialOrientation, paintBall, roll, type Mat3 } from "../src/ballRoll";

const R = 28.575;
/** Wohin der Punkt zeigt, der anfangs oben lag (Sichtkoordinaten). */
const top = (m: Mat3) => [m[2], m[5], m[8]];
const close = (a: readonly number[], b: readonly number[]) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 6));

describe("Rollende Kugeln", () => {
  it("dreht den obersten Punkt in Fahrtrichtung, eine Viertelumdrehung je Viertelumfang", () => {
    const quarter = (Math.PI / 2) * R;
    close(top(roll(identity(), quarter, 0, R)), [1, 0, 0]);
    close(top(roll(identity(), 0, -quarter, R)), [0, -1, 0]);
  });

  it("liegt nach einem vollen Umfang wieder wie vorher, auch in vielen kleinen Schritten", () => {
    let m = initialOrientation(11);
    const start = [...m];
    const steps = 500;
    const step = (2 * Math.PI * R) / steps;
    for (let i = 0; i < steps; i++) m = roll(m, step * 0.6, step * 0.8, R);
    close(m, start);
  });

  it("bleibt ohne Bewegung unverändert", () => {
    const m = initialOrientation(3);
    expect(roll(m, 0, 0, R)).toBe(m);
  });

  it("malt eine runde Kugel, deren Bild sich beim Rollen ändert", () => {
    const size = 32;
    const look = ballLook(9, { 1: 0xf2c230 });
    const paint = (m: Mat3) => {
      const data = new Uint8ClampedArray(size * size * 4);
      paintBall(data, size, look, m, () => 0);
      return data;
    };
    const still = paint(identity());
    expect(still[3]).toBe(0);
    expect(still[(16 * size + 16) * 4 + 3]).toBe(255);
    // Halbe Kugel: am oberen Rand Elfenbein, in der Mitte links das gelbe Band
    const pixel = (data: Uint8ClampedArray, x: number, y: number) => [...data.slice((y * size + x) * 4, (y * size + x) * 4 + 3)];
    const bandBlue = pixel(still, 16, 4)[2]!;
    const ivoryBlue = pixel(still, 27, 16)[2]!;
    expect(bandBlue).toBeLessThan(ivoryBlue - 60);
    expect([...paint(roll(identity(), 20, 5, R))]).not.toEqual([...still]);
  });
});
