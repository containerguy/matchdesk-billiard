import type { Ball } from "./physics";
import { TABLE, vec, type Vec } from "./table";

export type AimPreview = {
  /** Endpunkt der Ziellinie: Mittelpunkt der Geisterkugel oder Bandenpunkt. */
  end: Vec;
  /** Getroffene Kugel, falls die Linie eine Kugel trifft. */
  target: { id: number; pos: Vec; dir: Vec } | null;
  /** Laufrichtung der weißen Kugel nach dem Treffer (ohne Effet). */
  cueDir: Vec | null;
};

/** Berechnet die Zielhilfe: wo trifft die weiße Kugel zuerst, und wohin laufen beide Kugeln? */
export function aimPreview(balls: readonly Ball[], angle: number): AimPreview | null {
  const cue = balls.find((b) => b.id === 0 && !b.potted);
  if (!cue) return null;
  const r = TABLE.ballRadius;
  const d = vec.fromAngle(angle);
  let bestT = Infinity;
  let hit: Ball | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.potted) continue;
    const m = vec.sub(cue.pos, b.pos);
    const bq = vec.dot(m, d);
    const c = vec.dot(m, m) - 4 * r * r;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < bestT) {
      bestT = t;
      hit = b;
    }
  }
  const wallT = distanceToCushion(cue.pos, d);
  if (hit && bestT < wallT) {
    const ghost = vec.add(cue.pos, vec.scale(d, bestT));
    const n = vec.norm(vec.sub(hit.pos, ghost));
    const tangent = vec.sub(d, vec.scale(n, vec.dot(d, n)));
    return {
      end: ghost,
      target: { id: hit.id, pos: { ...hit.pos }, dir: n },
      cueDir: vec.len(tangent) < 1e-6 ? null : vec.norm(tangent)
    };
  }
  return { end: vec.add(cue.pos, vec.scale(d, wallT)), target: null, cueDir: null };
}

function distanceToCushion(p: Vec, d: Vec) {
  const r = TABLE.ballRadius;
  const ts: number[] = [];
  if (d.x > 0) ts.push((TABLE.width - r - p.x) / d.x);
  if (d.x < 0) ts.push((r - p.x) / d.x);
  if (d.y > 0) ts.push((TABLE.height - r - p.y) / d.y);
  if (d.y < 0) ts.push((r - p.y) / d.y);
  return Math.max(0, Math.min(...ts));
}
