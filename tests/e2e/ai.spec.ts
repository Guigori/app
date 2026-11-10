import { expect, test, type Page } from "@playwright/test";

// The notifications invitation would sit over the screens under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("finnos:notifications-prompt-dismissed-at", String(Date.now())));
});

// Simulated online session with synthetic data: not a test of Firebase Auth or real records.
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const day = String(Math.min(now.getDate(), 28)).padStart(2, "0");
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const me = {
  id: "test-browser-ai", name: "Pessoa de teste", email: "test@example.invalid", created_at: "2026-01-02T10:00:00Z",
  session_mode: "account", auth_provider: "password", auth_providers: ["password"],
};
const tx = (id: string, name: string, value: number) => ({
  id, version: 1, recurrence_id: null, name, value, type: "despesa", status: "pago", date: `${month}-${day}`,
  account_id: "bank", account_name: "Banco", card_id: null, card_name: null, to_account_id: null, to_account_name: null,
  category_id: "trans", category_name: "Transporte", category_color: "#0EA5E9", category_icon: "car",
  fixed: false, recurrence: null, installment: false, total_installments: null, current_installment: null,
  installment_value: null, adjusted_value: null, attachment: null, notes: null, notify_enabled: true, created_at: "2026-01-02T10:00:00Z",
});

async function session(page: Page, paidAsk: { calls: number }) {
  await page.addInitScript(() => window.localStorage.removeItem("finnos:mode"));
  await page.route("**/api/auth/me", (route) => route.fulfill(json(me)));
  await page.route("**/api/categories", (route) => route.fulfill(json([{ id: "trans", version: 1, name: "Transporte", color: "#0EA5E9", icon: "car", group: "necessidades", monthly_budget: 0, monthly_goal: 0, created_at: "2026-01-02T10:00:00Z" }])));
  await page.route("**/api/accounts", (route) => route.fulfill(json([{ id: "bank", version: 1, name: "Banco", institution: "Banco", type: "corrente", color: "#070F52", initial_balance: 0, active: true, balance: 900, total_income: 0, total_expense: 0, created_at: "2026-01-02T10:00:00Z" }])));
  await page.route("**/api/cards", (route) => route.fulfill(json([])));
  await page.route("**/api/radar", (route) => route.fulfill(json({ items: [], count: 0, active_count: 0 })));
  await page.route("**/api/ai/keys", (route) => route.fulfill(json([])));
  await page.route("**/api/transactions?**", (route) => route.fulfill(json([tx("u1", "Uber", 40), tx("u2", "Uber", 35), tx("b1", "Ônibus", 9)])));
  await page.route("**/api/ai/ask", (route) => { paidAsk.calls += 1; return route.fulfill(json({ detail: "Chamadas pagas de IA aguardam autorização neste ambiente." }, 503)); });
}

test("FINNOS IA answers a free question with the user's data, without a paid call", async ({ page }) => {
  const paidAsk = { calls: 0 };
  await session(page, paidAsk);
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Carteira" })).toBeVisible();
  const input = page.getByPlaceholder("Pergunte ao FINNOS…");
  // The assistant loads with the shell; ask again until its listener is in place.
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("finnos-ai-open")));
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await input.fill("compare uber e ônibus este mês");
  await input.press("Enter");
  await expect(page.getByText(/Uber: R\$ 75,00 em 2 lançamentos; Ônibus: R\$ 9,00 em 1 lançamento/)).toBeVisible();
  await expect(page.getByTestId("ai-bar-chart")).toBeVisible();
  await expect(page.getByTestId("ai-follow-ups")).toContainText("Evolução de Uber por mês");
  await page.getByTestId("ai-follow-ups").getByText("Evolução de Uber por mês").click();
  await expect(page.getByText(/Uber nos últimos 6 meses: média de/)).toBeVisible();

  await input.fill("me conta uma piada");
  await input.press("Enter");
  await expect(page.getByText("Ainda não sei responder essa pergunta com os seus dados.", { exact: false })).toBeVisible();
  expect(paidAsk.calls).toBe(1);
});

test("FINNOS IA learns what the user teaches and keeps it in the account", async ({ page }) => {
  const paidAsk = { calls: 0 };
  await session(page, paidAsk);
  const saved: string[] = [];
  await page.route("**/api/preferences", (route) => {
    if (route.request().method() === "PUT") saved.push(route.request().postDataJSON().values.finn_memory ?? "");
    return route.fulfill(json({ values: {} }));
  });
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Carteira" })).toBeVisible();
  const input = page.getByPlaceholder("Pergunte ao FINNOS…");
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("finnos-ai-open")));
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await input.fill("lembre que Uber é trabalho");
  await input.press("Enter");
  await expect(page.getByText("Anotado: Uber é trabalho.", { exact: false })).toBeVisible();
  await input.fill("quanto gastei de uber este mês?");
  await input.press("Enter");
  await expect(page.getByText("Você me disse: Uber é trabalho.", { exact: false })).toBeVisible();
  await expect.poll(() => saved.some((value) => value.includes("Uber é trabalho")), { timeout: 10000 }).toBe(true);
  expect(paidAsk.calls).toBe(0);
});

test("FINNOS IA prepares lançamentos from a sentence and saves only after the user confirms", async ({ page }) => {
  const paidAsk = { calls: 0 };
  await session(page, paidAsk);
  const created: Array<Record<string, unknown>> = [];
  await page.route("**/api/transactions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    created.push(body);
    return route.fulfill(json({ ...tx(`new-${created.length}`, body.name, body.value), category_id: body.category_id }));
  });
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Carteira" })).toBeVisible();
  const input = page.getByPlaceholder("Pergunte ao FINNOS…");
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("finnos-ai-open")));
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await input.fill("café 3,80 e uber 14 hoje");
  await input.press("Enter");
  const proposal = page.getByTestId("ai-proposal");
  await expect(proposal.getByTestId("ai-proposal-entry")).toHaveCount(2);
  await expect(page.getByTestId("ai-steps")).toContainText("Preparando os lançamentos");
  expect(created).toHaveLength(0);
  // Correct the first value, untick nothing, then confirm.
  await proposal.getByLabel("Valor de Café").fill("4,20");
  await proposal.getByLabel("Valor de Café").blur();
  await proposal.getByTestId("ai-proposal-apply").click();
  await expect(page.getByTestId("ai-proposal-status")).toContainText("Feito · 2");
  expect(created.map((c) => [c.name, c.value, c.category_id])).toEqual([["Café", 4.2, null], ["Uber", 14, "trans"]]);
  expect(paidAsk.calls).toBe(0);
});
