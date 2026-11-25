import { expect, test, type Page } from "@playwright/test";
import { hint, HINT, newPlayer, shotCount, tablePoint } from "./helpers";

type Aim = { phase: string; angle: number; placingPos: { x: number; y: number } | null; placingValid: boolean; cue: { x: number; y: number } | null };

const aim = (page: Page) => page.evaluate(() => (window as unknown as { bandenduellAim: () => unknown }).bandenduellAim()) as Promise<Aim>;
const degrees = (rad: number) => (rad * 180) / Math.PI;

test("Touchsteuerung am Smartphone: Weiße ziehen, wischend zielen, fein nachstellen, stoßen", async ({ browser }) => {
  const { context, page, errors } = await newPlayer(browser, { phone: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).tap();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Ohne" }).tap();
  await expect(hint(page)).toHaveText(/Kopflinie/);

  // Ein Finger, der auf dem Tisch liegt und wandert
  const cdp = await context.newCDPSession(page);
  const finger = async (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) => {
    const touchPoints = at ? [await tablePoint(page, at.x, at.y)] : [];
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  };
  const loupe = page.locator(".table-view");

  // Die Weiße folgt dem Finger, die Lupe zeigt die Stelle, gesetzt wird erst beim Loslassen
  await finger("touchStart", { x: 250, y: 300 });
  await finger("touchMove", { x: 330, y: 450 });
  await finger("touchMove", { x: 400, y: 560 });
  await expect.poll(async () => (await aim(page)).placingPos?.x).toBeCloseTo(400, -1);
  expect((await aim(page)).phase).toBe("placing");
  await expect(loupe).toHaveAttribute("data-loupe", "on");
  await finger("touchEnd");
  await expect(hint(page)).toHaveText(HINT.aiming);
  const placed = await aim(page);
  expect(placed.cue!.x).toBeCloseTo(400, -1);
  expect(placed.cue!.y).toBeCloseTo(560, -1);
  expect(degrees(placed.angle)).toBeCloseTo(0, 3);

  // Aufsetzen dreht den Queue nicht, Wischen dreht ihn Stück für Stück
  await finger("touchStart", { x: 1500, y: 560 });
  expect((await aim(page)).angle).toBe(placed.angle);
  const angles: number[] = [];
  for (let step = 1; step <= 6; step++) {
    await finger("touchMove", { x: 1500, y: 560 + step * 40 });
    angles.push(degrees((await aim(page)).angle));
  }
  await expect(loupe).toHaveAttribute("data-loupe", "on");
  // Beim Abheben rollt der Finger noch ein Stück: das verstellt das Ziel nicht
  await page.waitForTimeout(400);
  const aimed = (await aim(page)).angle;
  const roll = [await tablePoint(page, 1503, 812), await tablePoint(page, 1506, 824)];
  await Promise.all([
    cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [roll[0]!] }),
    cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [roll[1]!] }),
    cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  ]);
  await expect(hint(page)).toHaveText(HINT.aiming);
  expect((await aim(page)).angle).toBe(aimed);
  // Der Queue ist dem Finger gefolgt: um den überstrichenen Winkel, nicht bis zum Finger gesprungen
  expect(degrees(aimed)).toBeGreaterThan(5);
  expect(degrees(aimed)).toBeLessThan(15);
  for (let i = 1; i < angles.length; i++) expect(angles[i]!).toBeGreaterThanOrEqual(angles[i - 1]!);

  // Tippen zielt direkt auf den Punkt
  const target = await tablePoint(page, 1680, 560);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => degrees((await aim(page)).angle)).toBeCloseTo(0, 0);

  // Fein nachstellen in kleinen Schritten
  const tapped = degrees((await aim(page)).angle);
  await expect(loupe).toHaveAttribute("data-loupe", "off", { timeout: 15_000 });
  await page.getByRole("button", { name: "Fein nach rechts zielen" }).tap();
  await expect.poll(async () => degrees((await aim(page)).angle) - tapped).toBeCloseTo(0.15, 2);
  await page.getByRole("button", { name: "Fein nach links zielen" }).tap();
  await expect.poll(async () => degrees((await aim(page)).angle) - tapped).toBeCloseTo(0, 2);

  // Gehalten dreht der Knopf weiter, und die Lupe zeigt dabei den Zielpunkt
  const hold = (await page.getByRole("button", { name: "Fein nach rechts zielen" }).boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hold.x + hold.width / 2, y: hold.y + hold.height / 2 }] });
  await expect.poll(async () => degrees((await aim(page)).angle) - tapped).toBeGreaterThan(1);
  await expect(loupe).toHaveAttribute("data-loupe", "on");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const held = (await aim(page)).angle;
  await page.waitForTimeout(500);
  expect((await aim(page)).angle).toBe(held);

  // Die gesetzte Weiße lässt sich mit dem Finger noch einmal verschieben
  await finger("touchStart", { x: 400, y: 560 });
  await finger("touchMove", { x: 380, y: 620 });
  await finger("touchMove", { x: 350, y: 700 });
  expect((await aim(page)).phase).toBe("placing");
  await finger("touchEnd");
  await expect(hint(page)).toHaveText(HINT.aiming);
  expect((await aim(page)).cue!.y).toBeCloseTo(700, -1);

  // Stärke am Regler, Stoß per Knopf
  await page.touchscreen.tap(target.x, target.y);
  await page.locator("#power").fill("25");
  const before = await shotCount(page);
  await page.getByRole("button", { name: "Stoß", exact: true }).tap();
  await expect.poll(() => shotCount(page), { timeout: 40_000 }).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
