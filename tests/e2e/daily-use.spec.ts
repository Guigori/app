import { expect, test, type Page } from "@playwright/test";

// Local mode with an empty device: nothing here touches a server or real data.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:mode", "local"));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ detail: "Não autenticado." }),
  }));
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

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("pt-BR");
};

test("quick entry: typed on the keyboard, saved and listed in Fluxo", async ({ page }) => {
  await createAccount(page);
  await page.goto("/registro-inteligente");
  await expect(page.getByTestId("quick-entry")).toBeVisible();
  for (const key of ["1", "2", ",", "5", "+", "7"]) await page.keyboard.press(key);
  await expect(page.getByTestId("quick-entry-amount")).toHaveText("R$ 19,50");
  await page.getByRole("textbox", { name: "Nota" }).fill("Café teste");
  await page.getByRole("radiogroup", { name: "Categoria" }).getByRole("radio").nth(1).click();
  await page.getByTestId("quick-entry-save").click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();
  await page.goto("/transacoes");
  await expect(page.locator("text=Café teste >> visible=true").first()).toBeVisible();
});

test("tapping a lançamento explains it, and editing is one action inside", async ({ page }) => {
  await createAccount(page);
  await page.goto("/registro-inteligente");
  await expect(page.getByTestId("quick-entry")).toBeVisible();
  for (const key of ["4", "2"]) await page.keyboard.press(key);
  await expect(page.getByTestId("quick-entry-amount")).toHaveText("R$ 42");
  await page.getByRole("textbox", { name: "Nota" }).fill("Detalhe teste");
  await page.getByRole("radiogroup", { name: "Categoria" }).getByRole("radio").nth(1).click();
  await page.getByTestId("quick-entry-save").click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();
  await page.goto("/transacoes");
  await page.locator("text=Detalhe teste >> visible=true").first().click();
  const detail = page.getByTestId("transaction-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("transaction-detail-value")).toHaveText("-R$ 42,00");
  await expect(detail.getByTestId("transaction-detail-path")).toContainText("Conta Teste");
  await expect(detail.getByTestId("transaction-detail-rhythm")).toContainText("avulso");
  await expect(detail.getByTestId("transaction-detail-cashflow")).toHaveAttribute("href", /\/fluxo\?month=\d{4}-\d{2}&metric=despesas/);
  await detail.getByTestId("transaction-detail-edit").click();
  await expect(detail).toBeHidden();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("statement import flags what is already registered", async ({ page }) => {
  await createAccount(page);
  const csv = Buffer.from(`Data;Descrição;Valor\n${isoDaysAgo(2)};Padaria Teste;-12,50\n${isoDaysAgo(4)};Pix recebido;200,00`);
  const upload = async () => {
    await page.goto("/configuracoes/dados");
    await page.getByTestId("settings-import-statement").click();
    await page.getByTestId("statement-import-target").selectOption({ label: "Conta Teste" });
    await page.getByTestId("statement-import-file").setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: csv });
    await expect(page.getByTestId("statement-import-rows").locator("li")).toHaveCount(2);
  };
  await upload();
  await expect(page.getByTestId("statement-import-submit")).toHaveText("Importar 2");
  await page.getByTestId("statement-import-submit").click();
  await expect(page.getByTestId("statement-import-dialog")).toBeHidden();
  await upload();
  await expect(page.getByTestId("import-row-duplicate")).toHaveCount(2);
  await expect(page.getByTestId("statement-import-submit")).toBeDisabled();
});

test("cash flow leads with how the month closes, and Voltar keeps the chosen tab", async ({ page }) => {
  await page.goto("/fluxo?metric=caixa");
  await expect(page.getByText(/Deve (sobrar|faltar) no fim do mês|(Sobrou|Faltou) no mês/)).toBeVisible();
  await page.getByTestId("flow-tab-despesas").click();
  await page.getByTestId("flow-breadcrumb-back").click();
  await expect(page).toHaveURL(/\/transacoes/);
  await page.goBack();
  await expect(page.getByTestId("flow-tab-despesas")).toHaveAttribute("aria-selected", "true");
});
