import { expect, test, type Page } from "@playwright/test";
import { gameLog, newPlayer, shoot, visibleState, waitForTurn } from "./helpers";

type Position = {
  balls: Array<{ id: number; pos: { x: number; y: number }; vel: { x: number; y: number }; potted: boolean }>;
  lastPocket: { solids: number | null; stripes: number | null };
};

/**
 * Stellung auf der Diagonale von oben links nach unten rechts: Weiße, dahinter die 1 vor der Tasche
 * unten rechts, die 8 vor der Tasche oben links. Spieler 1 hat die Vollen, alle übrigen Vollen sind versenkt.
 */
function diagonal(options: { oneLeft: boolean; lastSolid: number | null }): Position & Record<string, unknown> {
  const ball = (id: number, x: number, y: number, potted = false) => ({ id, pos: { x, y }, vel: { x: 0, y: 0 }, potted });
  const balls = [ball(0, 1400, 700), ball(1, 1900, 950, !options.oneLeft), ball(8, 400, 200), ball(9, 300, 900)];
  for (let id = 2; id <= 15; id++) if (id !== 8 && id !== 9) balls.push(ball(id, 0, 0, true));
  return {
    balls,
    turn: 0,
    groups: ["solids", "stripes"],
    ballInHand: false,
    isBreak: false,
    fromKitchen: false,
    lastPocket: { solids: options.lastSolid, stripes: null },
    winner: null,
    winReason: null,
    shots: 10
  };
}

async function load(page: Page, position: Position) {
  await page.waitForFunction(() => typeof (window as unknown as { bandenduellLoad?: unknown }).bandenduellLoad === "function");
  await page.evaluate((state) => (window as unknown as { bandenduellLoad: (state: unknown) => void }).bandenduellLoad(state), position);
  await waitForTurn(page);
}

const ruleNote = (page: Page) => page.locator(".controls .rule-note");
const eightTarget = (page: Page, seat: number) => page.locator(".player").nth(seat).locator(".eight-target");

test("Kneipenregel: die 8 muss in die Tasche gegenüber der letzten eigenen Kugel", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser, { fast: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Ohne" }).click();

  // Solange noch eine eigene Kugel liegt, gibt es keine Vorgabe
  await load(page, diagonal({ oneLeft: true, lastSolid: 1 }));
  await expect(ruleNote(page)).toHaveCount(0);
  await expect(eightTarget(page, 0)).toHaveCount(0);

  // Die letzte Volle fällt unten rechts: die 8 muss nach oben links
  await shoot(page, { aimAt: { x: 1900, y: 950 }, power: 0.3 });
  await expect(gameLog(page).last()).toContainText("Spieler 1 versenkt die 1.");
  expect(((await visibleState(page)) as unknown as Position).lastPocket.solids).toBe(5);
  await expect(ruleNote(page)).toContainText("Die 8 muss in die markierte Tasche oben links");
  await expect(eightTarget(page, 0)).toHaveText("in die Tasche oben links");
  await expect(eightTarget(page, 1)).toHaveCount(0);

  // Die 8 fällt in die vorgegebene Tasche: gewonnen, mit Abschluss über dem Tisch
  await shoot(page, { aimAt: { x: 400, y: 200 }, power: 0.6 });
  await expect(gameLog(page).last()).toHaveText("Spieler 1 gewinnt (8 regulär versenkt).");
  await expect(page.locator(".celebration")).toHaveAttribute("data-result", "neutral");
  await expect(page.locator(".celebration-banner strong")).toHaveText("Spieler 1 gewinnt!");
  await expect(page.locator(".celebration .confetti i")).toHaveCount(70);

  // Gleiche Lage, aber die letzte Volle fiel oben links: vorgegeben ist unten rechts, oben links verliert
  await load(page, diagonal({ oneLeft: false, lastSolid: 0 }));
  await expect(page.locator(".celebration")).toHaveCount(0);
  await expect(ruleNote(page)).toContainText("Die 8 muss in die markierte Tasche unten rechts");
  await shoot(page, { aimAt: { x: 400, y: 200 }, power: 0.6 });
  await expect(gameLog(page).last()).toHaveText("Spieler 2 gewinnt (8 in die falsche Tasche versenkt).");
  await expect(page.locator(".celebration-banner strong")).toHaveText("Spieler 2 gewinnt!");
  expect(errors).toEqual([]);
});
