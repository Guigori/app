import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
  await page.route("**/api/auth/me", route => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ detail: "Não autenticado." }),
  }));
});

async function createCheckingAccount(page: import("@playwright/test").Page) {
  await page.goto("/contas");
  await expect(page.getByTestId("accounts-empty-create-button")).toBeVisible();
  await page.getByTestId("accounts-empty-create-button").click();
  const form = page.getByTestId("account-form");
  await form.getByTestId("account-name-input").fill("Conta Inter");
  await form.locator("#wallet-institution-name").fill("Banco Inter");
  await form.getByTestId("account-initial-input").fill("350,15");
  await form.getByTestId("account-submit-button").click();
  await expect(page.getByTestId("wallet-institutions")).toBeVisible();
  await expect(page.getByText("Banco Inter", { exact: true })).toBeVisible();
}

test("creates an institution-linked account and hides all balance figures", async ({ page }) => {
  await createCheckingAccount(page);
  await expect(page.getByTestId("wallet-balance")).toContainText("350,15");
  await expect(page.locator("[data-testid^=wallet-account-]")).toHaveCount(1);
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(page.getByTestId("wallet-balance")).toContainText("••••••");
  await expect(page.locator("[data-testid^=wallet-account-]")).not.toContainText("350,15");
  await page.getByRole("button", { name: "Mostrar valores" }).click();
  await expect(page.getByTestId("wallet-balance")).toContainText("350,15");
});

test("card issuer stays distinct from the linked payment account's bank", async ({ page }) => {
  await createCheckingAccount(page);
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const form = page.getByTestId("card-form");
  await form.getByTestId("card-name-input").fill("Cartão Nubank");
  await form.locator("#wallet-institution-name").fill("Nubank");
  await form.getByTestId("card-limit-input").fill("1000");
  await form.getByTestId("card-account-select").click();
  await page.getByRole("option", { name: "Conta Inter" }).click();
  await form.getByTestId("card-submit-button").click();
  await expect(page.locator("[data-testid^=wallet-card-]")).toHaveCount(1);
  const card = page.locator("[data-testid^=wallet-card-]").first();
  await expect(card).toContainText("Cartão Nubank");
  await expect(card).toContainText("Conta Inter");
  await expect(page.locator("[data-testid^=wallet-group-]")).toHaveCount(2);
});


test("manages standalone institutions and refuses silent account creation", async ({ page }) => {
  await page.goto("/contas");
  await page.getByRole("button", { name: "Instituições", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Instituições financeiras" });
  await expect(dialog).toBeVisible();
  await dialog.locator("#institution-create-name").fill("Banco Novo");
  await dialog.getByRole("button", { name: "Adicionar" }).click();
  await expect(dialog.getByText("Banco Novo")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByTestId("wallet-institutions")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toContainText("0,00");
  await page.getByRole("button", { name: "Instituições", exact: true }).click();
  await dialog.getByRole("button", { name: "Excluir instituição Banco Novo" }).click();
  await dialog.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(dialog.getByText("Banco Novo")).toHaveCount(0);
});
