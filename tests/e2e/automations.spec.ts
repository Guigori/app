import { expect, test, type Page } from "@playwright/test";
import { createFirstAccount } from "./walletHelpers";

// The notifications invitation would sit over the screens under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())));
});

// Local mode, data only in this test's browser.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Não autenticado." }) }));
});

async function createAccount(page: Page) {
  await createFirstAccount(page, { bank: "Banco Teste", nickname: "Conta Teste", balance: "1000" });
}

test("Integrações shows only Apple Pay and the AI", async ({ page }) => {
  await createAccount(page);
  await page.goto("/configuracoes/integracoes");
  // Without an account there is no server for the iPhone to talk to.
  await expect(page.getByTestId("integration-applepay-pendente")).toContainText("Precisa de conta");
  // The other Shortcuts flows are off for now.
  for (const id of ["integration-atalhos", "integration-applepay", "integration-sem-abrir", "integration-test-link"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await expect(page.getByText("O iPhone não deixa nenhum app ou site ler as notificações da Carteira.")).toBeVisible();

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

test("an account connects a shortcut: the code shows once, then only its last digits, and it can be disconnected", async ({ page }) => {
  // Account mode with the API simulated: nothing reaches a real account.
  await page.addInitScript(() => window.localStorage.removeItem("finnos:mode"));
  let tokens: Array<Record<string, unknown>> = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/auth/me")) return route.fulfill(json({ id: "u1", name: "Teste", email: "teste@example.com", created_at: "2026-01-01", session_mode: "account" }));
    if (url.includes("/integrations/shortcut-tokens") && method === "POST") {
      tokens = [{ id: "abcd1234abcd1234", label: "iPhone", hint: "WXYZ", created_at: "2026-11-05", last_used_at: null }];
      return route.fulfill(json({ ...tokens[0], token: "fns_TESTE_codigo_de_exemplo_que_nao_vale_WXYZ" }, 201));
    }
    if (url.includes("/integrations/shortcut-tokens/") && method === "DELETE") { tokens = []; return route.fulfill({ status: 204, body: "" }); }
    if (url.includes("/integrations/shortcut-tokens")) return route.fulfill(json(tokens));
    return route.fulfill(json([]));
  });
  // Apple Pay is open by default.
  await page.goto("/configuracoes/integracoes");
  const box = page.getByTestId("applepay-setup");
  await expect(box.getByTestId("applepay-status")).toContainText("Ainda não configurado");
  await box.getByTestId("applepay-create-code").click();
  await expect(box.getByTestId("applepay-fresh-code")).toContainText("fns_TESTE_codigo_de_exemplo_que_nao_vale_WXYZ");
  await expect(box.getByTestId("shortcut-tokens")).toContainText("•••• WXYZ");
  await page.reload();
  await expect(page.getByTestId("applepay-setup")).not.toContainText("fns_TESTE");
  await page.getByTestId("applepay-devices").getByRole("button", { name: "Desconectar" }).click();
  await expect(page.getByTestId("shortcut-tokens")).toHaveCount(0);
});
