import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Device-only mode tests the real wizard UI without a Firebase test account.
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
});

test("completes all six onboarding steps without inserting a fake transaction", async ({ page }) => {
  await page.goto("/onboarding");
  const wizard = page.getByTestId("onboarding-wizard");
  await expect(wizard).toBeVisible();
  await expect(page.getByText("Etapa 1 de 6")).toBeVisible();

  await page.locator("#onboard-name").fill("Pessoa Teste");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Etapa 2 de 6")).toBeVisible();

  await page.locator("#onboard-income").fill("3100,00");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Etapa 3 de 6")).toBeVisible();

  await page.getByRole("button", { name: /Personalizado/ }).click();
  const inputs = page.locator('input[type="number"]');
  await inputs.nth(0).fill("40");
  await inputs.nth(1).fill("25");
  await inputs.nth(2).fill("35");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Etapa 4 de 6")).toBeVisible();

  // User may skip adding institutions. No transactions are created by the wizard.
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Etapa 5 de 6")).toBeVisible();
  await expect(page.getByText("Exemplo — não será salvo")).toBeVisible();

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Etapa 6 de 6")).toBeVisible();
  await page.getByRole("button", { name: "Começar a usar FINNOS" }).click();
  await expect(page).toHaveURL(/\/$/);
  const state = await page.evaluate(() => localStorage.getItem("finnos:onboarding:local"));
  expect(JSON.parse(state || "{}").status).not.toBe("error");
});

test("validates custom budget and allows postponing onboarding", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
  await page.locator("#onboard-name").fill("Pessoa Teste");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: /Personalizado/ }).click();
  await page.locator('input[type="number"]').nth(0).fill("55");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("precisam somar 100%");
  await page.getByRole("button", { name: "Deixar para depois" }).click();
  await expect(page).toHaveURL(/\/$/);
  const value = await page.evaluate(() => localStorage.getItem("finnos:onboarding:local"));
  expect(JSON.parse(value || "{}").status).toBe("skipped");
});
