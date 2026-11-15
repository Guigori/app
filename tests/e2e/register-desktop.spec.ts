// The computer register: the recent list scrolls inside the card, so the account, ⋮ and date row stays reachable.
import { expect, test } from "@playwright/test";
import { createFirstAccount } from "./walletHelpers";
test("on the computer, the recent list does not push the account row out", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.addInitScript(() => { localStorage.setItem("finnos:mode", "local"); localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())); });
  await page.route("**/api/auth/me", (r) => r.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await createFirstAccount(page, { bank: "Banco Teste", nickname: "Conta Teste", balance: "3500" });
  for (const n of ["Mercado", "Uber", "Farmácia", "Padaria"]) {
    await page.getByTestId("quick-action-fab").click(); const d = page.getByTestId("register-drawer"); await d.waitFor(); await page.waitForTimeout(800);
    await page.keyboard.type("1234"); await d.getByLabel("Nome").fill(n); await d.getByRole("radio", { name: /Alimenta|Mercado|Compras/ }).first().click().catch(() => {});
    await page.getByTestId("quick-action-fab").click(); await page.waitForTimeout(1500); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }
  await page.getByTestId("quick-action-fab").click(); await page.waitForTimeout(1200);
  const drawer = await page.getByTestId("register-drawer").boundingBox();
  const row = await page.getByTestId("quick-entry-account").boundingBox();
  expect(row!.y + row!.height).toBeLessThanOrEqual(drawer!.y + drawer!.height);
});
