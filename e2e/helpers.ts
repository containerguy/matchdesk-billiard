import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** Maße der Tischansicht wie in apps/client/src/TableView.tsx (Rand und Maßstab in Canvas-Pixeln). */
const VIEW = { width: 960, rail: 40, scale: 880 / 2240 };

export const HINT = {
  opponent: "Dein Gegner ist am Zug.",
  rolling: "Kugeln rollen",
  placing: /Weiße Kugel links der Kopflinie setzen|Kugel in der Hand/,
  aiming: /^Zielen:/
};

/**
 * Lässt Stöße sofort ausrollen: der Client rechnet einen laufenden Stoß zu Ende, sobald der Tab
 * in den Hintergrund geht. Das Skript meldet diesen Zustand regelmäßig, damit ganze Partien
 * in Sekunden durchlaufen. Tests ohne diesen Aufruf sehen die Animation in Echtzeit.
 */
export async function skipAnimations(context: BrowserContext) {
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { get: () => hidden });
    setInterval(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      hidden = false;
    }, 50);
  });
}

export async function newPlayer(browser: Browser, options: { fast?: boolean; phone?: boolean } = {}) {
  const context = await browser.newContext(
    options.phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } }
  );
  if (options.fast) await skipAnimations(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page, errors };
}

export async function enterLobby(page: Page, name: string, path = "/") {
  await page.goto(path);
  await page.getByLabel("Dein Name").fill(name);
  await page.getByRole("button", { name: "Weiter zur Lobby" }).click();
}

/** Bildschirmkoordinaten eines Punktes auf dem Tisch (Millimeter). */
async function tablePoint(page: Page, x: number, y: number) {
  const canvas = page.locator(".table-view canvas");
  await canvas.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const box = (await canvas.boundingBox())!;
  const k = box.width / VIEW.width;
  return { x: box.x + (VIEW.rail + x * VIEW.scale) * k, y: box.y + (VIEW.rail + y * VIEW.scale) * k };
}

export const hint = (page: Page) => page.locator(".controls .hint");

/** Wartet, bis dieser Spieler am Zug ist oder die Partie vorbei ist. Gibt false zurück, wenn sie vorbei ist. */
export async function waitForTurn(page: Page, timeout = 60_000) {
  await expect(hint(page)).toHaveText(/Weiße Kugel|Kugel in der Hand|^Zielen:|Partie vorbei/, { timeout });
  return !(await hint(page).innerText()).includes("Partie vorbei");
}

/**
 * Führt einen Stoß über die Oberfläche aus: bei Bedarf die Weiße setzen, auf einen Punkt zielen,
 * Stärke am Regler einstellen und den Stoß-Knopf drücken.
 */
export async function shoot(page: Page, options: { place?: { x: number; y: number }; aimAt: { x: number; y: number }; power: number; touch?: boolean; settleTimeout?: number; wait?: boolean }) {
  const tap = async (p: { x: number; y: number }) => {
    const at = await tablePoint(page, p.x, p.y);
    if (options.touch) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
  };
  if (/Weiße Kugel|Kugel in der Hand/.test(await hint(page).innerText())) {
    const spots = [options.place ?? { x: 400, y: 560 }, { x: 300, y: 300 }, { x: 500, y: 820 }, { x: 250, y: 600 }, { x: 450, y: 150 }, { x: 1100, y: 250 }];
    for (const spot of spots) {
      await tap(spot);
      if (/^Zielen:/.test(await hint(page).innerText())) break;
    }
    await expect(hint(page)).toHaveText(HINT.aiming);
  }
  const aim = await tablePoint(page, options.aimAt.x, options.aimAt.y);
  if (options.touch) await page.touchscreen.tap(aim.x, aim.y);
  else await page.mouse.move(aim.x, aim.y, { steps: 2 });
  await page.locator("#power").fill(String(Math.round(options.power * 100)));
  const before = await shotCount(page);
  await page.getByRole("button", { name: "Stoß", exact: true }).click();
  if (options.wait === false) return;
  await expect.poll(() => shotCount(page), { timeout: options.settleTimeout ?? 40_000 }).toBeGreaterThan(before);
}

/** Zahl der fertig ausgewerteten Stöße der laufenden Partie. */
export async function shotCount(page: Page) {
  return Number(await page.locator(".controls").getAttribute("data-shots"));
}

export const gameLog = (page: Page) => page.locator("ol.log li");

/** Einfacher fester Zufall, damit Testläufe wiederholbar sind. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

type VisibleState = { balls: Array<{ id: number; pos: { x: number; y: number }; potted: boolean }>; ballInHand: boolean; isBreak: boolean };

/** Der Spielstand, wie ihn dieser Spieler gerade sieht. */
export async function visibleState(page: Page) {
  await page.waitForFunction(() => typeof (window as unknown as { bandenduellState?: unknown }).bandenduellState === "function");
  return page.evaluate(() => (window as unknown as { bandenduellState: () => unknown }).bandenduellState()) as Promise<VisibleState>;
}

const POCKETS = [
  { x: 0, y: 0 },
  { x: 1120, y: 0 },
  { x: 2240, y: 0 },
  { x: 0, y: 1120 },
  { x: 1120, y: 1120 },
  { x: 2240, y: 1120 }
];

/**
 * Ein Stoß, der die Partie schnell beendet: mit voller Kraft auf die 8, bei Kugel in der Hand
 * in gerader Linie zur nächsten Tasche. Fällt die 8 zu früh, ist die Partie verloren und damit vorbei.
 */
export async function shootAtEight(page: Page) {
  const state = await visibleState(page);
  const eight = state.balls.find((ball) => ball.id === 8)!.pos;
  const pocket = [...POCKETS].sort((a, b) => Math.hypot(a.x - eight.x, a.y - eight.y) - Math.hypot(b.x - eight.x, b.y - eight.y))[0]!;
  const length = Math.hypot(pocket.x - eight.x, pocket.y - eight.y) || 1;
  const behind = { x: eight.x - ((pocket.x - eight.x) / length) * 220, y: eight.y - ((pocket.y - eight.y) / length) * 220 };
  await shoot(page, { place: state.isBreak ? { x: 400, y: 560 } : behind, aimAt: eight, power: 1 });
}
