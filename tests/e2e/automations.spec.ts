import { expect, test, type Page } from "@playwright/test";

// Local mode, data only in this test's browser.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Não autenticado." }) }));
});

async function createAccount(page: Page) {
  await page.goto("/contas");
  await page.getByTestId("accounts-empty-create-button").click();
  const form = page.getByTestId("account-form");
  await form.getByTestId("account-name-input").fill("Conta Teste");
  await form.locator("#wallet-institution-name").fill("Banco Teste");
  await form.getByTestId("account-initial-input").fill("1000");
  await form.getByTestId("account-submit-button").click();
  await expect(page.getByTestId("wallet-institutions")).toBeVisible();
}

test("a Shortcuts link opens the register already understood, and nothing is saved before confirming", async ({ page }) => {
  await createAccount(page);
  await page.goto("/configuracoes/integracoes");
  await expect(page.getByTestId("integration-atalhos")).toContainText("Disponível");
  await expect(page.getByTestId("integration-notificacoes")).toContainText("Indisponível no iPhone");
  await page.getByTestId("integration-test-link").click();
  const recognized = page.getByTestId("register-recognized");
  await expect(recognized.getByTestId("ai-proposal-entry")).toHaveCount(2);
  // The data travelled after "#" and is cleared once read.
  await expect(page).toHaveURL(/\/registro-inteligente$/);

  await page.goto("/registro-inteligente#valor=R%24%2012%2C50&nome=Padaria&cartao=Conta%20Teste");
  await expect(recognized.getByTestId("ai-proposal-entry")).toHaveCount(1);
  await expect(recognized.getByLabel("Valor de Padaria")).toHaveValue("12,50");
});

test("the register has no voice, photo or attachment for now, and the install guide opens from Settings", async ({ page }) => {
  await createAccount(page);
  await page.goto("/registro-inteligente");
  await page.getByRole("button", { name: "Registro inteligente: escrever como foi" }).click();
  await expect(page.getByText("Voz, foto e anexo chegam em breve.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Falar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fotografar recibo" })).toHaveCount(0);

  await page.goto("/configuracoes");
  await page.getByRole("link", { name: /Instalar no celular/ }).click();
  const install = page.getByTestId("install-app");
  await expect(install).toBeVisible();
  await install.getByRole("tab", { name: "iPhone" }).click();
  await expect(install).toContainText("Adicionar à Tela de Início");
});

test("the balance chart keeps the tooltip on today, with every selected line", async ({ page }) => {
  await createAccount(page);
  await page.goto("/");
  const chart = page.getByTestId("home-projection-chart");
  await expect(chart).toBeVisible();
  // Before anything is touched, the tooltip is already on screen, on today.
  const tooltip = chart.getByTestId("home-chart-tooltip");
  await expect(tooltip).toContainText(`Dia ${String(new Date().getDate()).padStart(2, "0")}`);
  await page.getByTestId("home-chart-series-expense").click();
  await page.getByTestId("home-chart-series-income").click();
  await expect(tooltip).toContainText("Saldo");
  await expect(tooltip).toContainText("Receitas");
  await expect(tooltip).toContainText("Despesas");
  await expect(chart.getByTestId("home-chart-tooltip")).toHaveCount(1);
});

test("Integrações has the place to connect your own AI", async ({ page }) => {
  await page.goto("/configuracoes/integracoes#sua-ia");
  const item = page.getByTestId("integration-sua-ia");
  await expect(item).toContainText("Conectar sua IA");
  // Local mode keeps no keys, so it points to creating an account.
  await expect(item).toContainText("Crie sua conta preservando seus dados");
});
