import { expect, test, type Page } from "@playwright/test";
import { gameLog, newPlayer, shoot, visibleState, waitForTurn } from "./helpers";

type Vec = { x: number; y: number };
type RuleState = {
  balls: Array<{ id: number; pos: Vec; potted: boolean }>;
  turn: 0 | 1;
  groups: Array<"solids" | "stripes" | null>;
  ballInHand: boolean;
  isBreak: boolean;
  fromKitchen: boolean;
  lastPocket: { solids: number | null; stripes: number | null };
};

const R = 28.575;
/** Zielpunkte knapp vor den Taschen, in der Reihenfolge der Taschen im Spiel. */
const POCKET_AIMS: Vec[] = [
  { x: 20, y: 20 },
  { x: 1120, y: 0 },
  { x: 2220, y: 20 },
  { x: 20, y: 1100 },
  { x: 1120, y: 1120 },
  { x: 2220, y: 1100 }
];
const POCKET_NAMES = ["oben links", "oben Mitte", "oben rechts", "unten links", "unten Mitte", "unten rechts"];
const groupOf = (id: number) => (id >= 1 && id <= 7 ? "solids" : id >= 9 ? "stripes" : null);

/** Spielt für den Spieler am Zug eine erlaubte Kugel möglichst gerade in eine Tasche. */
async function playTurn(page: Page, state: RuleState) {
  if (state.isBreak) return shoot(page, { place: { x: 400, y: 560 }, aimAt: { x: 1680, y: 560 }, power: 0.9 });
  const cue = state.balls.find((ball) => ball.id === 0)!.pos;
  const live = state.balls.filter((ball) => ball.id !== 0 && !ball.potted);
  // Spieler 2 überlässt den Tisch: ein kurzer Stoß ins Leere ist ein Foul und gibt Spieler 1 Kugel in der Hand.
  // So räumt Spieler 1 seine Gruppe in wenigen Stößen ab.
  if (state.turn === 1 && !state.ballInHand) {
    const clear = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2)
      .map((angle) => ({ x: Math.cos(angle), y: Math.sin(angle) }))
      .find((dir) => live.every((ball) => {
        const rel = { x: ball.pos.x - cue.x, y: ball.pos.y - cue.y };
        const along = rel.x * dir.x + rel.y * dir.y;
        return along < 0 || along > 500 || Math.abs(rel.x * dir.y - rel.y * dir.x) > 3 * R;
      }));
    if (clear) return shoot(page, { aimAt: { x: cue.x + clear.x * 200, y: cue.y + clear.y * 200 }, power: 0.04 });
  }
  const group = state.groups[state.turn]!;
  const own = group === null ? live.filter((ball) => ball.id !== 8) : live.filter((ball) => groupOf(ball.id) === group);
  const targets = own.length > 0 ? own : live.filter((ball) => ball.id === 8);
  const required = own.length === 0 && group !== null && state.lastPocket[group] !== null ? 5 - state.lastPocket[group]! : null;
  const free = state.ballInHand && !state.fromKitchen;
  let best: { ghost: Vec; place: Vec; cost: number } | null = null;
  for (const target of targets) {
    for (const [index, pocket] of POCKET_AIMS.entries()) {
      if (required !== null && index !== required) continue;
      const distance = Math.hypot(pocket.x - target.pos.x, pocket.y - target.pos.y);
      const dir = { x: (pocket.x - target.pos.x) / distance, y: (pocket.y - target.pos.y) / distance };
      const ghost = { x: target.pos.x - dir.x * 2 * R, y: target.pos.y - dir.y * 2 * R };
      const place = { x: target.pos.x - dir.x * 260, y: target.pos.y - dir.y * 260 };
      const toGhost = { x: ghost.x - cue.x, y: ghost.y - cue.y };
      const length = Math.hypot(toGhost.x, toGhost.y) || 1;
      const cut = free ? 0 : Math.acos(Math.max(-1, Math.min(1, (toGhost.x * dir.x + toGhost.y * dir.y) / length)));
      const cost = cut * 1000 + distance;
      if (!best || cost < best.cost) best = { ghost, place, cost };
    }
  }
  await shoot(page, { place: free ? best!.place : { x: 400, y: 560 }, aimAt: best!.ghost, power: 0.45 });
}

test("Kneipenregel: die 8 muss in die Tasche gegenüber der letzten eigenen Kugel", async ({ browser }) => {
  test.setTimeout(480_000);
  const { page, errors } = await newPlayer(browser, { fast: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Ohne" }).click();

  // Beide Seiten am selben Tisch spielen, bis ein Spieler auf die 8 muss. Endet eine Partie vorher, neu beginnen.
  let announced = false;
  for (let game = 0; game < 4 && !announced; game++) {
    if (game > 0) await page.getByRole("button", { name: "Neue Partie" }).click();
    for (let turn = 0; turn < 250; turn++) {
      if (!(await waitForTurn(page))) break;
      const state = (await visibleState(page)) as unknown as RuleState;
      const group = state.groups[state.turn] ?? null;
      const onEight = group !== null && state.balls.every((ball) => groupOf(ball.id) !== group || ball.potted);
      if (onEight) {
        // Die vorgegebene Tasche ist benannt und liegt der Tasche der letzten eigenen Kugel gegenüber
        const last = state.lastPocket[group]!;
        expect(last).not.toBeNull();
        await expect(page.locator(".controls .rule-note")).toContainText(`Die 8 muss in die markierte Tasche ${POCKET_NAMES[5 - last]}`);
        await expect(page.locator(".player").nth(state.turn).locator(".eight-target")).toContainText(POCKET_NAMES[5 - last]!);
        announced = true;
      } else {
        expect(await page.locator(".controls .rule-note").count()).toBe(0);
      }
      await playTurn(page, state);
    }
  }
  expect(announced).toBe(true);

  // Die Partie zu Ende spielen: die 8 entscheidet, in welcher Tasche auch immer
  for (let turn = 0; turn < 250 && (await waitForTurn(page)); turn++) await playTurn(page, (await visibleState(page)) as unknown as RuleState);
  await expect(gameLog(page).last()).toContainText(/gewinnt \(8 (regulär versenkt|in die falsche Tasche versenkt|mit Foul versenkt|zu früh versenkt)\)/);
  expect(errors).toEqual([]);
});
