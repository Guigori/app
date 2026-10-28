import { expect, test, type Page } from "@playwright/test";

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const dateValue = `${currentMonth}-03`;
const json = (body: unknown, status = 200) => ({
  status, contentType: "application/json", body: JSON.stringify(body),
});
const me = {
  id: "test-browser-fiint", name: "Pessoa de teste",
  email: "test@example.invalid", created_at: "2026-01-02T10:00:00Z",
  session_mode: "account", auth_provider: "password", auth_providers: ["password"],
};
const transaction = {
  id: "series-root", version: 2, recurrence_id: "stable-series-1",
  name: "Aluguel", value: 100, type: "despesa", status: "pago",
  date: dateValue, account_id: "bank", account_name: "Banco",
  card_id: null, card_name: null, to_account_id: null,
  to_account_name: null, category_id: "rent", category_name: "Moradia",
  category_color: "#123456", category_icon: "home",
  fixed: true, recurrence: "mensal", installment: false,
  total_installments: null, current_installment: null,
  installment_value: null, adjusted_value: null,
  attachment: null, notes: null, notify_enabled: true,
  created_at: "2026-01-02T10:00:00Z",
};
const accounts = [{
  id: "bank", version: 1, name: "Banco", institution: "Banco",
  type: "corrente", color: "#070F52", initial_balance: 0,
  active: true, balance: 500, total_income: 500, total_expense: 0,
  created_at: "2026-01-02T10:00:00Z",
}];
const categories = [{
  id: "rent", version: 1, name: "Moradia", color: "#64748B",
  icon: "home", group: "necessidades", monthly_budget: 0,
  monthly_goal: 0, created_at: "2026-01-02T10:00:00Z",
}];

async function syntheticAccountSession(page: Page) {
  // Browser component E2E uses a simulated identity. This is NOT a test of
  // Firebase Auth credentials, verification or actual Firestore Rules.
  await page.addInitScript(() => window.localStorage.removeItem("finnos:mode"));
  await page.route("**/api/auth/me", route => route.fulfill(json(me)));
}

test("FIINT displays twelve audited months and never fabricates a score on HTTP error", async ({ page }) => {
  await syntheticAccountSession(page);
  const months = Array.from({ length: 12 }, (_, index) => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11 + index, 1));
    return {
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      income: index === 11 ? 3100 : 0,
      expense: index === 11 ? 800 : 0,
      net: index === 11 ? 2300 : 0,
      entries: index === 11 ? 3 : 0,
      has_confirmed_data: index === 11,
    };
  });
  await page.route("**/api/finance/fiint", route => route.fulfill(json({
    version: "fiint-v1", status: "read_only",
    finance_revision: 14, score: 60, score_max: 100,
    score_label: "Completude do acompanhamento",
    maturity_month: 1, months_observed: 1, history_span_months: 1,
    stage: "M1", history_start: currentMonth,
    criteria: [
      { id: "accounts", label: "Configurar pelo menos uma conta ativa", completed: true, points: 20 },
      { id: "history", label: "Acompanhar movimentações em três meses distintos", completed: false, points: 20 },
    ],
    monthly_history: months,
    data_quality: {
      active_accounts: 1, categories: 2, months_with_settled_records: 1,
      active_subscriptions: 0, has_open_budget: false,
    },
    is_financial_health_score: false, writes_data: false,
    disclaimer: "Não é uma avaliação da saúde financeira.",
  })));
  await page.goto("/analise");
  const fiint = page.getByTestId("fiint-maturity");
  await expect(fiint).toBeVisible();
  await expect(fiint).toContainText("60");
  await expect(fiint).toContainText("revisão financeira 14");
  await expect(fiint.locator('[role="list"][aria-label="Movimentações por mês"] [role="listitem"]')).toHaveCount(12);
  await expect(fiint).toContainText("não sua saúde financeira");
});

test("recurrence editor sends scoped changes with a durable operation ID", async ({ page }) => {
  await syntheticAccountSession(page);
  await page.route("**/api/accounts", route => route.fulfill(json(accounts)));
  await page.route("**/api/categories", route => route.fulfill(json(categories)));
  await page.route("**/api/cards", route => route.fulfill(json([])));
  await page.route("**/api/transactions/page?**", route => route.fulfill(json({
    month: currentMonth, items: [transaction], next_cursor: null,
  })));
  await page.route("**/api/transactions?**", route => route.fulfill(json([transaction])));
  let captured: { url: string; id: string | null; version: string | null; payload: unknown } | null = null;
  await page.route("**/api/transactions/series-root/recurrence", async route => {
    const request = route.request();
    captured = {
      url: request.url(), id: request.headers()["x-finnos-operation-id"] ?? null,
      version: request.headers()["x-finnos-base-version"] ?? null,
      payload: request.postDataJSON(),
    };
    await route.fulfill(json({
      ...transaction, id: "new-occurrence", value: 125,
      status: "agendado", fixed: false, version: 1,
    }));
  });
  await page.goto("/transacoes?metric=caixa");
  await page.getByTestId("edit-transaction-series-root").click();
  await page.getByTestId("open-recurrence-scope").click();
  const dialog = page.getByTestId("recurrence-scope-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#recurrence-value").fill("125");
  await dialog.getByRole("radio", { name: /Somente esta ocorrência/ }).check();
  await dialog.getByTestId("recurrence-save").click();
  await expect.poll(() => captured).not.toBeNull();
  const call = captured as unknown as { id: string; version: string; payload: { scope: string; changes: { value: number } } };
  expect(call.version).toBe("2");
  expect(call.id).toBeTruthy();
  expect(call.payload.scope).toBe("esta");
  expect(call.payload.changes.value).toBe(125);
  await expect(dialog).not.toBeVisible();
});
