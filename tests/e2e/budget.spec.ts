import { expect, test, type Page } from "@playwright/test";

// Simulated online session with synthetic data: not a test of Firebase Auth or real records.
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const me = {
  id: "test-browser-budget", name: "Pessoa de teste", email: "test@example.invalid", created_at: "2026-01-02T10:00:00Z",
  session_mode: "account", auth_provider: "password", auth_providers: ["password"],
};
const tx = (over: Record<string, unknown>) => ({
  id: "t", version: 1, recurrence_id: null, name: "iFood", value: 80, type: "despesa", status: "pago", date: `${month}-03`,
  account_id: "bank", account_name: "Banco", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "rest", category_name: "Restaurantes", category_color: "#C2410C", category_icon: "utensils",
  fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null,
  installment_value: null, adjusted_value: null, attachment: null, notes: null, notify_enabled: true,
  created_at: "2026-01-02T10:00:00Z", ...over,
});
const cycle = {
  id: "c1", mode: "personalizado", period: "mensal", start_date: `${month}-01`, end_date: `${month}-${last}`,
  expected_income: 5000, allocations: [{ category_id: "rest", planned: 500, priority: "flexivel", rollover: false }],
  extraordinary: false, status: "ativo", created_at: "2026-01-02T10:00:00Z",
};
const progress = {
  cycle_id: "c1", start_date: cycle.start_date, end_date: cycle.end_date, planned: 500, spent: 80, committed: 70,
  available: 350, projected_close: 150, expected_income: 5000, received_income: 0, committed_income: 0,
  safe_to_spend: 4850, elapsed_percent: 20, used_percent: 30, pace: "no_ritmo",
  allocations: [{ category_id: "rest", planned: 500, priority: "flexivel", rollover: false, name: "Restaurantes",
    icon: "utensils", color: "#C2410C", spent: 80, committed: 70, available: 350, projected_close: 150, percent: 30 }],
};

async function session(page: Page) {
  await page.addInitScript(() => { window.localStorage.removeItem("finnos:mode"); window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())); });
  await page.route("**/api/auth/me", (route) => route.fulfill(json(me)));
  await page.route("**/api/budgets/current", (route) => route.fulfill(json(cycle)));
  await page.route("**/api/budgets/next", (route) => route.fulfill(json(null)));
  await page.route("**/api/budgets/c1/progress", (route) => route.fulfill(json(progress)));
  await page.route("**/api/transactions?**", (route) => route.fulfill(json([
    tx({ id: "paid" }), tx({ id: "soon", name: "Jantar", value: 50, status: "agendado", date: `${month}-${String(Math.min(25, last))}` }),
  ])));
}

test("a budget category lists the lançamentos that used its limit, each opening its detail", async ({ page }) => {
  await session(page);
  await page.goto("/orcamento");
  const row = page.getByTestId("budget-allocation").first();
  await row.getByTestId("budget-allocation-toggle").click();
  const detail = row.getByTestId("budget-allocation-detail");
  await expect(detail).toContainText("Já saiu");
  await expect(detail).toContainText("iFood");
  await expect(detail).toContainText("Ainda vai sair");
  await expect(detail).toContainText("Jantar");
  // 80 + 70 in the cycle, 80 + 50 listed: R$ 20 come from fixed series, installments or subscriptions.
  await expect(detail.getByTestId("budget-allocation-other")).toContainText("20,00");
  await detail.getByTestId("allocation-transaction").first().click();
  const sheet = page.getByTestId("record-insight").filter({ visible: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("transaction-detail-budget")).toContainText("ciclo");
  await expect(sheet.getByTestId("transaction-detail-budget")).toContainText("150,00 de R$ 500,00");
});
