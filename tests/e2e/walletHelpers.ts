import { expect, type Page } from "@playwright/test";

/** Etapa 6: the bank is registered in four steps (bank, uses, account, review). */
export async function fillBankWizard(page: Page, opts: { bank: string; nickname: string; balance: string }) {
  const form = page.getByTestId("account-form");
  await expect(form).toBeVisible();
  await form.getByTestId("bank-wizard-other").click();
  await form.locator("#wallet-institution-name").fill(opts.bank);
  await form.getByTestId("bank-wizard-next").click();
  await form.getByTestId("bank-wizard-next").click();
  await form.getByTestId("account-initial-input").fill(opts.balance);
  await form.getByTestId("account-name-input").fill(opts.nickname);
  await form.getByTestId("bank-wizard-next").click();
  await form.getByTestId("account-submit-button").click();
  await expect(form).toHaveCount(0);
}

/** First account from the empty Carteira. With one bank the Carteira shows that bank (tela 15). */
export async function createFirstAccount(page: Page, opts: { bank: string; nickname: string; balance: string }) {
  await page.goto("/contas");
  await page.getByTestId("accounts-empty-create-button").click();
  await fillBankWizard(page, opts);
  await expect(page.getByTestId("wallet-single-bank")).toBeVisible();
}

/** Opens the bank screen whether the Carteira shows one bank (tela 15) or the list. */
export async function openFirstBank(page: Page) {
  const single = page.getByTestId("wallet-single-bank-card");
  if (await single.count()) await single.click();
  else await page.locator("[data-testid^=wallet-bank-]").first().click();
  await expect(page.getByTestId("wallet-bank-page")).toBeVisible();
}

/** Picks the card's bank: an existing chip, or "Banco novo" with the name typed. */
export async function pickCardBank(page: Page, bank: string) {
  const form = page.getByTestId("card-form");
  const chip = form.getByTestId(`card-bank-${bank}`);
  if (await chip.count()) await chip.click();
  else {
    await form.getByTestId("card-bank-new").click();
    await form.locator("#wallet-institution-name").fill(bank);
  }
}
