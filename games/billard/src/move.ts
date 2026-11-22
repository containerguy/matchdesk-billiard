import type { BillardMove } from "./rules";

/** Prüft die Form eines Zuges, der übers Netz kommt. Inhaltliche Prüfung macht `checkMove`. */
export function parseMove(raw: unknown): BillardMove | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const shot = m.shot as Record<string, unknown> | undefined;
  if (!shot || typeof shot !== "object") return null;
  const spin = shot.spin as Record<string, unknown> | undefined;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!num(shot.angle) || !num(shot.power) || !spin || !num(spin.x) || !num(spin.y)) return null;
  const move: BillardMove = { shot: { angle: shot.angle, power: shot.power, spin: { x: spin.x, y: spin.y } } };
  if (m.cueBallPos !== undefined) {
    const p = m.cueBallPos as Record<string, unknown> | null;
    if (!p || !num(p.x) || !num(p.y)) return null;
    move.cueBallPos = { x: p.x, y: p.y };
  }
  return move;
}
