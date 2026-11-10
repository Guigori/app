import { expect, test } from "@playwright/test";

// The notifications invitation would sit over the screens under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())));
});

// Local mode with a synthetic goal: nothing here touches a server or real data.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("finnos:mode", "local");
    if (!window.localStorage.getItem("finnos:goals:v1:local")) {
      window.localStorage.setItem("finnos:goals:v1:local", JSON.stringify([{
        id: "g-trip", name: "Viagem teste", category: "Viagem", mode: "tradicional", target: 2000, saved: 300, months: 10,
        contribution: 200, frequency: "Mensal", account: "", strategy: null, remind: false, radar: false,
        createdAt: "2026-08-01T12:00:00Z", deposits: [],
      }]));
    }
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Não autenticado." }) }));
});

test("a goal asks where the money comes from, shows its whole history and lets money go back to an account", async ({ page }) => {
  await page.goto("/contas");
  await page.getByTestId("accounts-empty-create-button").click();
  const form = page.getByTestId("account-form");
  await form.getByTestId("account-name-input").fill("Conta Teste");
  await form.locator("#wallet-institution-name").fill("Banco Teste");
  await form.getByTestId("account-initial-input").fill("1000");
  await form.getByTestId("account-submit-button").click();
  await expect(page.getByTestId("wallet-institutions")).toBeVisible();

  await page.goto("/metas");
  const card = page.getByTestId("goal-g-trip");
  await card.getByTestId("goal-deposit-button").click();
  const money = page.getByTestId("goal-money-sheet");
  await expect(money).toContainText("De onde vem esse dinheiro?");
  await money.getByTestId("goal-money-amount").fill("150");
  await money.getByRole("button", { name: /Conta Teste/ }).click();
  await money.getByLabel("Nota").fill("bônus");
  await money.getByTestId("goal-money-save").click();
  await expect(card).toContainText("R$ 450,00");

  await card.getByTestId("goal-open").click();
  const detail = page.getByTestId("goal-detail");
  await expect(detail.getByTestId("goal-detail-plan")).toContainText("Faltam R$ 1.550,00");
  await detail.getByTestId("goal-detail-withdraw").click();
  await expect(money).toContainText("Para onde vai esse dinheiro?");
  await money.getByTestId("goal-money-amount").fill("50");
  await money.getByRole("button", { name: /Conta Teste/ }).click();
  await money.getByTestId("goal-money-save").click();
  const rows = detail.getByTestId("goal-history-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Retirado para Conta Teste");
  await expect(rows.nth(1)).toContainText("Guardado de Conta Teste");
  await expect(rows.nth(1)).toContainText("bônus");
  await expect(rows.nth(2)).toContainText("Valor inicial");
});
