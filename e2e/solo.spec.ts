import { expect, test } from "@playwright/test";
import { gameLog, hint, HINT, newPlayer, seeded, shoot, waitForTurn } from "./helpers";

test("Solo-Partie gegen den Computer bis zum Ende", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser, { fast: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Schwer" }).click();
  await expect(page.locator(".player .name").nth(1)).toContainText("Computer (Schwer)");

  const rnd = seeded(8);
  let computerShots = 0;
  let turns = 0;
  for (; turns < 200; turns++) {
    if (!(await waitForTurn(page, 90_000))) break;
    await shoot(page, { place: { x: 400, y: 560 }, aimAt: turns === 0 ? { x: 1680, y: 560 } : { x: rnd() * 2240, y: rnd() * 1120 }, power: turns === 0 ? 0.9 : 0.3 + rnd() * 0.3 });
    if ((await gameLog(page).allInnerTexts()).some((line) => line.startsWith("Computer"))) computerShots++;
  }
  expect(turns).toBeLessThan(200);
  expect(computerShots).toBeGreaterThan(0);
  await expect(page.locator(".badge", { hasText: "Gewonnen" })).toHaveCount(1);
  await expect(gameLog(page).last()).toContainText("gewinnt");

  // Neue Partie beginnt wieder mit dem eigenen Anstoß
  await page.getByRole("button", { name: "Neue Partie" }).click();
  await expect(hint(page)).toHaveText(/Kopflinie/);
  expect(errors).toEqual([]);
});

test("Der Computer stößt sichtbar in Echtzeit, freies Üben bleibt möglich", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser, { phone: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Leicht" }).click();

  // Ein Anstoß ins Leere ist ein Foul, danach ist der Computer mit Kugel in der Hand dran
  await waitForTurn(page);
  await shoot(page, { place: { x: 400, y: 560 }, aimAt: { x: 400, y: 100 }, power: 0.2, touch: true });
  await expect(gameLog(page).last()).toContainText("Foul von Spieler", { timeout: 30_000 });
  await expect(hint(page)).toHaveText(HINT.opponent);
  await expect(page.locator(".player").nth(1).locator(".badge")).toHaveText(/Kugel in der Hand|Am Zug/);
  await expect(hint(page)).toContainText(HINT.rolling, { timeout: 15_000 });
  await expect(hint(page)).not.toContainText(HINT.rolling, { timeout: 40_000 });

  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Ohne" }).click();
  await expect(page.locator(".player .name").nth(1)).toContainText("Spieler 2");
  await expect(hint(page)).toHaveText(/Kopflinie/);
  expect(errors).toEqual([]);
});
