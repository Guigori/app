import { expect, test, type Page } from "@playwright/test";
import { createFirstAccount } from "./walletHelpers";

// Native-app gestures on the phone layout. Local mode with an empty device: nothing touches a server.
test.skip(({ isMobile }) => !isMobile, "touch gestures exist only on the phone layout");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("finnos:mode", "local");
    window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now()));
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ detail: "Não autenticado." }),
  }));
  await createFirstAccount(page, { bank: "Banco Teste", nickname: "Conta Teste", balance: "1000" });
});

/** A finger drag, as the phone sends it: touchstart, a few touchmoves, touchend. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, { steps = 12, ms = 240 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms / steps);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function settle(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}(\\?.*)?$`));
  await expect(page.getByTestId("mobile-nav")).toBeVisible();
  await page.waitForTimeout(400);
}

test("swiping sideways moves between the bottom-bar tabs", async ({ page }) => {
  await page.goto("/");
  await settle(page, "/");
  // On Início the balance chart owns sideways drags (it changes the month): swipe on the balance above it.
  await drag(page, { x: 320, y: 180 }, { x: 60, y: 186 });
  await settle(page, "/transacoes");
  await drag(page, { x: 320, y: 420 }, { x: 60, y: 425 });
  await settle(page, "/analise");
  await drag(page, { x: 80, y: 420 }, { x: 340, y: 425 });
  await settle(page, "/transacoes");
});

test("a sideways drag on the balance chart stays with the chart", async ({ page }) => {
  await page.goto("/");
  await settle(page, "/");
  const chart = page.locator("[data-gesture='ignore']").first();
  await expect(chart).toBeVisible();
  const box = await chart.boundingBox();
  if (!box) throw new Error("no chart");
  const y = box.y + Math.min(box.height / 2, 120);
  await drag(page, { x: 320, y }, { x: 60, y: y + 5 });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/$/);
});

test("a short or vertical drag does not change the tab", async ({ page }) => {
  await page.goto("/transacoes");
  await settle(page, "/transacoes");
  await drag(page, { x: 250, y: 420 }, { x: 200, y: 425 }, { ms: 600 });
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/transacoes$/);
  await drag(page, { x: 200, y: 600 }, { x: 230, y: 300 });
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/transacoes$/);
});

test("swiping right on an inner screen goes back", async ({ page }) => {
  await page.goto("/configuracoes/avancado");
  await settle(page, "/configuracoes/avancado");
  await drag(page, { x: 120, y: 420 }, { x: 370, y: 430 });
  await settle(page, "/configuracoes");
});

test("the left edge opens the menu on a tab, and swiping it back closes it", async ({ page }) => {
  await page.goto("/");
  await settle(page, "/");
  await drag(page, { x: 6, y: 420 }, { x: 200, y: 425 });
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(400);
  await drag(page, { x: 250, y: 500 }, { x: 20, y: 505 });
  await expect(drawer).toBeHidden();
});

test("pulling down at the top refreshes", async ({ page }) => {
  await page.goto("/");
  await settle(page, "/");
  const indicator = page.getByTestId("pull-to-refresh");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 260 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: 260 + i * 25 }] });
    await page.waitForTimeout(20);
  }
  await expect(indicator).toHaveAttribute("data-armed", "true");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(indicator).toHaveAttribute("data-refreshing", "true");
  await expect(indicator).toHaveAttribute("data-refreshing", "false", { timeout: 5000 });
  await expect(page).toHaveURL(/\/$/);
});

test("dragging the register's handle down closes it", async ({ page }) => {
  await page.goto("/");
  await settle(page, "/");
  await page.getByTestId("mobile-quick-action-button").click();
  const sheet = page.getByRole("dialog", { name: "Novo registro" });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  const grip = await page.getByTestId("register-sheet-grip").boundingBox();
  if (!grip) throw new Error("no grip");
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(start.x, start.y + i * 30); await page.waitForTimeout(16); }
  await page.mouse.up();
  await expect(sheet).toBeHidden();
});
