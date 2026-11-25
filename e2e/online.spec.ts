import { expect, test } from "@playwright/test";
import { ballRoll, enterLobby, gameLog, hint, HINT, newPlayer, shoot, shootAtEight, waitForTurn } from "./helpers";

test("Online-Partie zwischen Desktop und Smartphone: Einladung, Stöße in Echtzeit, Chat, Aufgabe", async ({ browser }) => {
  const rene = await newPlayer(browser);
  const mia = await newPlayer(browser, { phone: true });

  await enterLobby(rene.page, "René");
  await rene.page.getByRole("button", { name: "Privat mit Einladungslink" }).click();
  const link = await rene.page.locator("#invite-link").inputValue();
  expect(link).toMatch(/\/\?t=[A-Z2-9]{5}$/);

  // Mia kommt über den Einladungslink direkt an den Tisch
  await enterLobby(mia.page, "Mia", new URL(link).pathname + new URL(link).search);
  await expect(rene.page.locator(".player .name").nth(1)).toContainText("Mia");
  await expect(hint(mia.page)).toHaveText(HINT.opponent);

  // René stößt an; beide sehen die Kugeln rollen und danach denselben Spielverlauf
  await waitForTurn(rene.page);
  const cueBefore = await ballRoll(mia.page, 0);
  await shoot(rene.page, { place: { x: 400, y: 560 }, aimAt: { x: 1680, y: 560 }, power: 0.9, wait: false });
  await expect(hint(mia.page)).toContainText(HINT.rolling);
  // Die Kugeln rollen sichtbar: die Weiße dreht sich bei beiden mit
  await expect.poll(() => ballRoll(mia.page, 0)).not.toEqual(cueBefore);
  await expect.poll(() => ballRoll(rene.page, 0)).not.toEqual(cueBefore);
  await expect(hint(rene.page)).not.toContainText(HINT.rolling, { timeout: 40_000 });
  await expect(hint(mia.page)).not.toContainText(HINT.rolling, { timeout: 40_000 });
  expect(await gameLog(mia.page).allInnerTexts()).toEqual(await gameLog(rene.page).allInnerTexts());

  // Der nächste Stoß kommt vom Spieler am Zug, am Smartphone per Touch
  const reneNext = !(await hint(rene.page).innerText()).includes(HINT.opponent);
  const next = reneNext ? rene : mia;
  const other = reneNext ? mia : rene;
  await shoot(next.page, { aimAt: { x: 1700, y: 500 }, power: 0.12, touch: !reneNext, wait: false });
  await expect(hint(other.page)).toContainText(HINT.rolling);
  await expect(hint(next.page)).not.toContainText(HINT.rolling, { timeout: 40_000 });
  await expect(hint(other.page)).not.toContainText(HINT.rolling, { timeout: 40_000 });
  expect(await gameLog(mia.page).allInnerTexts()).toEqual(await gameLog(rene.page).allInnerTexts());

  // Chat am Tisch
  await mia.page.getByPlaceholder(/Nachricht/).last().fill("Guter Stoß!");
  await mia.page.getByPlaceholder(/Nachricht/).last().press("Enter");
  await expect(rene.page.getByText("Guter Stoß!")).toBeVisible();

  // Mia gibt auf: sie landet in der Lobby, René bleibt am Tisch und sieht den Grund
  await mia.page.getByRole("button", { name: "Aufgeben und Tisch verlassen" }).click();
  await expect(mia.page.getByRole("button", { name: "Privat mit Einladungslink" })).toBeVisible();
  await expect(rene.page.getByText("Mia hat den Tisch verlassen.")).toBeVisible();

  expect(rene.errors).toEqual([]);
  expect(mia.errors).toEqual([]);
});

test("Online-Partie bis zum Ende und Revanche", async ({ browser }) => {
  const a = await newPlayer(browser, { fast: true });
  const b = await newPlayer(browser, { fast: true });
  await enterLobby(a.page, "Anna");
  await a.page.getByLabel("Tischname").fill("Finale");
  await a.page.getByRole("button", { name: "Tisch eröffnen" }).click();

  // Ben findet den Tisch in der Lobby-Liste
  await enterLobby(b.page, "Ben");
  await b.page.getByRole("listitem").filter({ hasText: "Finale" }).getByRole("button", { name: "Beitreten" }).click();
  await expect(a.page.locator(".player .name").nth(1)).toContainText("Ben");

  let shots = 0;
  for (; shots < 80; shots++) {
    const state = await Promise.race([waitForTurn(a.page).then((on) => ({ page: a.page, on })), waitForTurn(b.page).then((on) => ({ page: b.page, on }))]);
    if (!state.on) break;
    await shootAtEight(state.page);
  }
  expect(shots).toBeLessThan(80);

  // Beide sehen dasselbe Ergebnis
  await expect(a.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(2);
  await expect(b.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(2);
  await expect(a.page.locator(".score")).toHaveText(/1 : 0|0 : 1/);
  expect(await gameLog(b.page).allInnerTexts()).toEqual(await gameLog(a.page).allInnerTexts());

  // Revanche: erst wenn beide wollen, beginnt die nächste Partie mit Anstoß
  await a.page.getByRole("button", { name: "Revanche" }).click();
  await expect(b.page.getByRole("button", { name: "Revanche annehmen" })).toBeVisible();
  await b.page.getByRole("button", { name: "Revanche annehmen" }).click();
  await expect(a.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(0);
  await expect.poll(async () => (await hint(a.page).innerText()) + (await hint(b.page).innerText())).toContain("Kopflinie");

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
