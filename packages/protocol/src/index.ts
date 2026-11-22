import type { Seat } from "@bandenduell/core";
import { z } from "zod";

/**
 * Nachrichten zwischen Browser und Spielserver (JSON über WebSocket).
 * Spielspezifische Teile (Zug, Spielzustand) sind hier `unknown`;
 * das jeweilige Spielpaket prüft und deutet sie.
 */

const vecSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), name: z.string(), token: z.string().max(64).optional() }),
  z.object({ t: z.literal("createTable"), name: z.string().max(40), private: z.boolean() }),
  z.object({ t: z.literal("joinTable"), tableId: z.string().max(40).optional(), code: z.string().max(12).optional() }),
  z.object({ t: z.literal("leaveTable") }),
  z.object({ t: z.literal("chat"), scope: z.enum(["lobby", "table"]), text: z.string().max(300) }),
  z.object({ t: z.literal("aim"), angle: z.number().finite(), power: z.number().min(0).max(1), cuePos: vecSchema.nullable() }),
  z.object({ t: z.literal("shoot"), move: z.unknown() }),
  z.object({ t: z.literal("rematch") })
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type TableStatus = "waiting" | "playing" | "finished";

export type TableSummary = {
  id: string;
  name: string;
  game: string;
  host: string;
  players: string[];
  status: TableStatus;
};

export type SeatInfo = { name: string; connected: boolean } | null;

export type TableView = {
  id: string;
  name: string;
  game: string;
  /** Beitrittscode, nur für Spieler am Tisch sichtbar. */
  code: string;
  private: boolean;
  seats: [SeatInfo, SeatInfo];
  status: TableStatus;
  mySeat: Seat | null;
  /** Spielzustand des jeweiligen Spiels (bei Billard: `BillardState`). */
  state: unknown;
  score: [number, number];
  rematch: [boolean, boolean];
  /** Warum die letzte Partie endete, falls nicht regulär (z. B. Aufgabe). */
  endNote: string | null;
};

export type OnlinePlayer = { id: string; name: string; status: "lobby" | "waiting" | "playing" };

export type ServerMessage =
  | { t: "welcome"; playerId: string; token: string; name: string }
  | { t: "lobby"; tables: TableSummary[]; online: OnlinePlayer[] }
  | { t: "table"; table: TableView | null }
  | { t: "aim"; seat: Seat; angle: number; power: number; cuePos: { x: number; y: number } | null }
  | { t: "shot"; seat: Seat; before: unknown; move: unknown; after: unknown; events: unknown[] }
  | { t: "chat"; scope: "lobby" | "table"; from: string; text: string; at: number }
  | { t: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Anzeigenamen säubern: Steuerzeichen weg, Leerraum zusammenfassen, 1–20 Zeichen. */
export function cleanName(name: string): string | null {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return cleaned.length > 0 ? cleaned : null;
}
