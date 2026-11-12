import { expect, test } from "@playwright/test";

// The notifications invitation would sit over the screens under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())));
});

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
  await expect(page.getByTestId("wallet-institutions").getByText("Banco Inter", { exact: true })).toBeVisible();
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

test("card issuer stays distinct from the account's bank and the card has no paying account", async ({ page }) => {
  await createCheckingAccount(page);
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const form = page.getByTestId("card-form");
  await form.getByTestId("card-name-input").fill("Cartão Nubank");
  await form.locator("#wallet-institution-name").fill("Nubank");
  await form.getByTestId("card-limit-input").fill("1000");
  // Etapa 2: the paying account is chosen when paying the invoice.
  await expect(form.getByTestId("card-account-select")).toHaveCount(0);
  await expect(form.getByTestId("card-pay-note")).toBeVisible();
  await form.getByTestId("card-submit-button").click();
  await expect(page.locator("[data-testid^=wallet-card-]")).toHaveCount(1);
  const card = page.locator("[data-testid^=wallet-card-]").first();
  await expect(card).toContainText("Cartão Nubank");
  await expect(card).not.toContainText("Conta Inter");
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
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByTestId("wallet-institutions")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toContainText("0,00");
  await page.getByRole("button", { name: "Instituições", exact: true }).click();
  await dialog.getByRole("button", { name: "Excluir instituição Banco Novo" }).click();
  await dialog.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(dialog.getByText("Banco Novo")).toHaveCount(0);
});

test("cards live inside Carteira and Assinaturas stays its own screen", async ({ page }) => {
  await page.goto("/cartoes");
  await expect(page).toHaveURL(/\/contas\?aba=cartoes$/);
  await expect(page.getByTestId("wallet-tab-cartoes")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("wallet-tab-contas").click();
  await expect(page).toHaveURL(/\/contas$/);
  await page.goto("/assinaturas");
  await expect(page).toHaveURL(/\/assinaturas$/);
  await expect(page.getByTestId("subscriptions-panel")).toBeVisible();
});

test("an account opens its own cash flow, which can go back to every account", async ({ page }) => {
  await createCheckingAccount(page);
  await page.locator("[data-testid^=wallet-account-]").first().click();
  await page.getByTestId("account-detail-cashflow").click();
  await expect(page).toHaveURL(/\/transacoes\?aba=caixa&account_id=/);
  await expect(page.getByTestId("flow-account-filter")).toContainText("Conta Inter");
  await page.getByTestId("flow-tab-projecao").click();
  await expect(page.getByTestId("flow-upcoming")).toContainText("Nada previsto");
  await page.getByTestId("flow-account-clear").click();
  await expect(page.getByTestId("flow-account-filter")).toHaveCount(0);
});

test("conferência: a statement line is registered from the register and the account becomes conferida", async ({ page }) => {
  await createCheckingAccount(page);
  await page.locator("[data-testid^=wallet-account-]").first().click();
  await page.getByTestId("account-detail-reconcile").click();
  await expect(page).toHaveURL(/\/contas\/.+\/conferencia/);
  const day = new Date(Date.now() - 2 * 86_400_000);
  const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${ymd}120000<TRNAMT>-29.90<FITID>SINT-1<MEMO>TARIFA PACOTE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>320.25<DTASOF>${ymd}</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  await page.getByTestId("recon-file-input").setInputFiles({ name: "extrato-sintetico.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(ofx) });
  await expect(page.getByTestId("recon-bank")).toContainText("320,25");
  await expect(page.getByTestId("recon-finnos")).toContainText("350,15");
  const line = page.getByTestId("recon-line-0");
  await expect(line).toHaveAttribute("data-state", "open");
  await line.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByTestId("tx-name-input")).toHaveValue("TARIFA PACOTE");
  await page.getByTestId("tx-submit-button").click();
  await expect(line).toHaveAttribute("data-state", "matched");
  await expect(page.getByTestId("recon-diff")).toContainText("0,00");
  await page.getByTestId("recon-complete").click();
  await expect(page.getByTestId("recon-done")).toContainText("conferida até");
});

test("benefit card: two benefits with separate balances, chosen at registration, split when one runs short", async ({ page }) => {
  await page.goto("/contas");
  await page.getByTestId("accounts-empty-create-button").click();
  const form = page.getByTestId("account-form");
  await form.getByTestId("account-name-input").fill("Caju");
  await form.getByTestId("account-type-select").click();
  await page.getByRole("option", { name: "Benefício" }).click();
  await form.locator("#wallet-institution-name").fill("Caju Benefícios");
  await form.getByTestId("wallet-name-0").fill("Refeição");
  await form.getByTestId("wallet-initial-0").fill("100");
  await form.getByTestId("wallet-add").click();
  await form.getByTestId("wallet-name-1").fill("Mercado");
  await form.getByTestId("wallet-initial-1").fill("50");
  await form.getByTestId("account-submit-button").click();
  await expect(page.getByTestId("wallet-balance")).toContainText("150,00");

  await page.goto("/registro-inteligente");
  await expect(page.getByTestId("quick-entry")).toBeVisible();
  const wallets = page.getByTestId("quick-entry-wallets");
  await expect(wallets.getByRole("radio", { checked: true })).toContainText("Refeição");
  await wallets.getByRole("radio", { name: /Mercado/ }).click();
  for (const key of ["8", "0"]) await page.keyboard.press(key);
  await page.getByRole("textbox", { name: "Nome" }).fill("Feira");
  await page.getByRole("radiogroup", { name: "Categoria" }).getByRole("radio").nth(1).click();
  await page.getByTestId("quick-entry-save").click();
  const split = page.getByTestId("quick-entry-benefit-split");
  await expect(split).toContainText("Mercado tem R$ 50,00");
  await split.getByRole("button", { name: "Resto em Refeição" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();

  await page.goto("/contas");
  await page.locator("[data-testid^=wallet-account-]").first().click();
  const list = page.getByTestId("account-detail-wallets");
  await expect(list).toContainText("Refeição");
  await expect(list.locator("li").filter({ hasText: "Refeição" })).toContainText("70,00");
  await expect(list.locator("li").filter({ hasText: "Mercado" })).toContainText("0,00");
  await expect(page.getByTestId("account-detail-balance")).toContainText("70,00");
});
