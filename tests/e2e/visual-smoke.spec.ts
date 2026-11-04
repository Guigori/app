import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
  await page.route("**/api/auth/me", route => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ detail: "Não autenticado." }),
  }));
});

test("principal FINNOS routes render without viewport overflow on desktop/mobile", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const routes = [
    { path: "/", name: "dashboard" },
    { path: "/contas", name: "carteira" },
    { path: "/transacoes?metric=caixa", name: "fluxo-transacoes" },
    { path: "/cartoes", name: "cartoes" },
    { path: "/radar", name: "radar" },
    { path: "/analise", name: "analises" },
    { path: "/patrimonio", name: "patrimonio" },
    { path: "/assinaturas", name: "assinaturas" },
  ];
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(900);
    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect.soft(
      widths.scrollWidth, `${testInfo.project.name}: ${route.path} must fit ${widths.viewport}px`,
    ).toBeLessThanOrEqual(widths.viewport + 3);
    await page.screenshot({
      path: testInfo.outputPath(`FINNOS-${testInfo.project.name}-${route.name}.png`),
      fullPage: true,
    });
  }
});
