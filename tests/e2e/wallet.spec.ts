import { expect, test } from "@playwright/test";
import { createFirstAccount, fillBankWizard, openFirstBank, pickCardBank } from "./walletHelpers";

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
  await createFirstAccount(page, { bank: "Banco Inter", nickname: "Conta Inter", balance: "350,15" });
  await expect(page.getByTestId("wallet-single-bank-card")).toContainText("Banco Inter");
}

test("creates an institution-linked account and hides all balance figures", async ({ page }) => {
  await createCheckingAccount(page);
  // Tela 15 (prototype "Com 1 banco"): the Carteira is that bank's card, the month and the invite to add more.
  const bankCard = page.getByTestId("wallet-single-bank-card");
  await expect(bankCard).toContainText("350,15");
  await expect(page.getByTestId("wallet-counts")).toContainText("1 banco");
  await expect(page.getByTestId("wallet-single-month")).toBeVisible();
  await expect(page.getByTestId("wallet-single-add-banco")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(bankCard).toContainText("••••");
  await expect(bankCard).not.toContainText("350,15");
  await page.getByRole("button", { name: "Mostrar valores" }).click();
  await expect(bankCard).toContainText("350,15");
});

test("card issuer stays distinct from the account's bank and the card has no paying account", async ({ page }) => {
  await createCheckingAccount(page);
  // Etapa 6: one "+" asks what is being added.
  await page.getByTestId("wallet-add").click();
  await page.getByTestId("wallet-add-cartao").click();
  const form = page.getByTestId("card-form");
  await pickCardBank(page, "Nubank");
  await form.getByTestId("card-name-input").fill("Cartão Nubank");
  await form.getByTestId("card-limit-input").fill("1000");
  // Etapa 2: the paying account is chosen when paying the invoice.
  await expect(form.getByTestId("card-account-select")).toHaveCount(0);
  await expect(form.getByTestId("card-pay-note")).toBeVisible();
  await form.getByTestId("card-submit-button").click();
  // Etapa 6 (prototype): the card is in the carousel and its bank gets its own row ("Só cartão de crédito").
  await expect(page.locator("[data-testid^=carousel-card-]")).toHaveCount(1);
  await expect(page.locator("[data-testid^=carousel-card-]").first()).toContainText("Cartão Nubank");
  await expect(page.locator("[data-testid^=wallet-bank-]")).toHaveCount(2);
  const nubank = page.locator("[data-testid^=wallet-bank-]").filter({ hasText: "Nubank" });
  await expect(nubank).toContainText("Só cartão de crédito");
  await expect(page.locator("[data-testid^=wallet-bank-]").filter({ hasText: "Banco Inter" })).not.toContainText("Crédito");
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
  // Etapa 6: "Tudo" is the first tab and keeps the plain /contas address.
  await page.getByTestId("wallet-tab-tudo").click();
  await expect(page).toHaveURL(/\/contas$/);
  await page.goto("/assinaturas");
  await expect(page).toHaveURL(/\/assinaturas$/);
  await expect(page.getByTestId("subscriptions-panel")).toBeVisible();
});

test("an account opens its own cash flow, which can go back to every account", async ({ page }) => {
  await createCheckingAccount(page);
  // Etapa 6: the bank opens the bank screen; the account is listed there.
  await openFirstBank(page);
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
  // Etapa 6: the bank opens the bank screen; the account is listed there.
  await openFirstBank(page);
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
  // Prototype: every decision stays in the history, opened from the header.
  await page.getByTestId("recon-history-open").click();
  await expect(page.getByTestId("recon-history")).toContainText("TARIFA PACOTE");
});

test("benefit card: two benefits with separate balances, chosen at registration, split when one runs short", async ({ page }) => {
  await page.goto("/contas");
  await page.getByTestId("wallet-first-beneficio").click();
  const form = page.getByTestId("benefit-form");
  await form.getByTestId("benefit-wizard-issuer-Caju").click();
  await form.getByTestId("benefit-wizard-purpose-multi").click();
  await form.getByTestId("wallet-name-0").fill("Refeição");
  await form.getByTestId("wallet-initial-0").fill("100");
  await form.getByTestId("wallet-name-1").fill("Mercado");
  await form.getByTestId("wallet-initial-1").fill("50");
  await form.getByTestId("account-submit-button").click();
  await expect(form).toHaveCount(0);
  // Etapa 6: benefits have their own indicator, apart from the money in accounts.
  await expect(page.getByTestId("wallet-ind-benefits")).toContainText("150,00");

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
  // Etapa 6: each benefit tile opens the benefit screen (prototype "9 · Benefício").
  await page.locator("[data-testid^=wallet-benefit-mini-]").first().click();
  await expect(page.getByTestId("benefit-page")).toBeVisible();
  const chips = page.getByRole("tablist", { name: "Benefícios do cartão" });
  await expect(chips.getByRole("tab", { name: /Refeição/ })).toContainText("70,00");
  await expect(chips.getByRole("tab", { name: /Mercado/ })).toContainText("0,00");
});

test("nova Carteira: as in the prototype — summary, stacked cards, one row per bank, benefit tiles, invoices and the + sheet", async ({ page }) => {
  await page.goto("/contas");
  // Primeiro uso.
  await expect(page.getByTestId("wallet-first-use")).toContainText("Comece pelo seu banco principal");
  await page.getByTestId("wallet-first-dinheiro").click();
  await page.getByTestId("wallet-cash-input").fill("180");
  await page.getByTestId("wallet-cash-save").click();
  await expect(page.getByTestId("wallet-balance")).toContainText("180,00");

  await page.goto("/contas");
  await page.getByTestId("wallet-add").click();
  await expect(page.getByTestId("wallet-add-sheet")).toContainText("O que você quer adicionar?");
  await page.getByTestId("wallet-add-banco").click();
  await fillBankWizard(page, { bank: "Banco Inter", nickname: "Conta Inter", balance: "350,15" });

  await page.getByTestId("wallet-add").click();
  await page.getByTestId("wallet-add-beneficio").click();
  const form = page.getByTestId("benefit-form");
  await form.getByTestId("benefit-wizard-issuer-Caju").click();
  await form.getByTestId("benefit-wizard-purpose-multi").click();
  await form.getByTestId("wallet-name-0").fill("Refeição");
  await form.getByTestId("wallet-initial-0").fill("120");
  await form.getByTestId("wallet-name-1").fill("Mercado");
  await form.getByTestId("wallet-initial-1").fill("80");
  await form.getByTestId("account-submit-button").click();
  await expect(form).toHaveCount(0);
  for (const [name, bankName, digits, makeDefault] of [["Roxinho", "Nubank", "1234", false], ["Laranja", "Banco Inter", "9876", true]] as const) {
    await page.getByTestId("wallet-add").click();
    await page.getByTestId("wallet-add-cartao").click();
    const card = page.getByTestId("card-form");
    await pickCardBank(page, bankName);
    await card.getByTestId("card-name-input").fill(name);
    await card.getByTestId("card-last-digits-input").fill(digits);
    await expect(card.getByTestId("card-preview")).toContainText(`•••• ${digits}`);
    await card.getByTestId("card-limit-input").fill("1000");
    if (makeDefault) await card.getByTestId("card-default-checkbox").click();
    await card.getByTestId("card-submit-button").click();
    await expect(card).toHaveCount(0);
  }

  await expect(page.getByTestId("wallet-counts")).toHaveText("2 bancos · 2 cartões · 1 benefício");
  // Each part has its own value, never added together (v1.1).
  await expect(page.getByTestId("wallet-balance")).toContainText("530,15");
  await expect(page.getByTestId("wallet-ind-benefits")).toContainText("200,00");
  await expect(page.getByTestId("wallet-composition")).toBeVisible();

  // The default card is in front; the dots move between cards.
  await expect(page.getByTestId("wallet-carousel-pos")).toHaveText("2 de 2");
  await expect(page.getByRole("button", { name: /^Laranja/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("wallet-carousel-dot-0").click();
  await expect(page.getByTestId("wallet-carousel-pos")).toHaveText("1 de 2");
  await expect(page.getByRole("button", { name: /^Roxinho/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("wallet-carousel")).not.toContainText(/visa|master/i);
  await page.getByTestId("wallet-cards-view").click();
  await expect(page.getByTestId("wallet-cards-list")).toContainText("final 1234");
  await page.getByTestId("wallet-cards-view").click();

  // Bancos e contas: one row per bank, cash at the end.
  await expect(page.locator("[data-testid^=wallet-bank-]").filter({ hasText: "Banco Inter" })).toContainText("Conta · Pix · Débito · Crédito");
  await expect(page.locator("[data-testid^=wallet-bank-]").filter({ hasText: "Nubank" })).toContainText("sem conta");
  // Benefits: a tile per benefit.
  await expect(page.locator("[data-testid^=wallet-benefit-mini-]")).toHaveCount(2);

  // Bank screen.
  await page.locator("[data-testid^=wallet-bank-]").filter({ hasText: "Banco Inter" }).click();
  await expect(page.getByTestId("wallet-bank-page")).toContainText("Formas de pagamento");
  await expect(page.getByTestId("wallet-bank-balance")).toContainText("350,15");
  await expect(page.getByTestId("wallet-bank-page")).toContainText("•••• 9876");
  await page.getByTestId("wallet-bank-transfer").click();
  await expect(page.getByTestId("tx-account-select")).toContainText("Conta Inter");
});
