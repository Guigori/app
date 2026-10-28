import { firebaseAuth } from "@/lib/firebase";
// Single data boundary for the whole app. Every page/dialog calls these helpers so
// "conta local" (browser-only) and "conta completa" (server) share one call shape:
// in account mode they hit /api via src/lib/api.ts, in local mode the browser engine.

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { localRadar } from "@/lib/local/radar";
import { isLocalMode, getMode } from "@/lib/mode";
import { loadSessionProfile } from "@/lib/profileIdentity";
import { queueTransaction, queueTransactionDelete, queueEntityCreate, queueEntityMutation, flushSyncQueue, listSyncOperations, isTransactionSyncOperation, type OperationSource } from "@/lib/sync/queue";
import { cacheSet, cachedFetch } from "@/lib/offline/accountCache";
import {
  localFinanceHistory,
  localClearData,
  localCreateAccount,
  localListInstitutions,
  localCreateInstitution,
  localDeleteInstitution,
  localCreateCategory,
  localCreateTransaction,
  localDashboard,
  localDeleteAccount,
  localDeleteCategory,
  localDeleteTransaction,
  localGetAccount,
  localGetProfile,
  localListAccounts,
  localListCategories,
  localListTransactions,
  localLoadDemo,
  localSetName,
  localUpdateAccount,
  localUpdateCategory,
  localUpdateTransaction,
  localTrends,
  localBudget,
  localFlow,
  localListCards,
  localCreateCard,
  localUpdateCard,
  localDeleteCard,
  localNotifications,
  localInvoice,
  localPayInvoice,
  localCreditInvoice,
  localBankRefund,
  localSubscriptions,
  localCreateSubscription,
  localUpdateSubscription,
  localDeleteSubscription,
  localCalendar,
  type LocalTxFilters,
} from "@/lib/local/engine";
import type {
  Account,
  AccountDetail,
  AccountInput,
  Institution,
  InstitutionInput,
  FinanceHistoryPage,
  FinanceIntegrity,
  BudgetSummary,
  BudgetSuggestion,
  BudgetCycle,
  BudgetCycleProgress,
  CalendarMonth,
  CardInput,
  CreditCard,
  Invoice,
  NotifyPrefs,
  NotifyPrefsInput,
  Notifications,
  PayInvoiceInput,
  CreditInvoiceInput,
  BankRefundInput,
  Subscriptions,
  SubscriptionInput,
  SubscriptionItem,
  Category,
  CategoryInput,
  Dashboard,
  Flow,
  FlowParams,
  Transaction,
  TransactionInput,
  TransactionPage,
  Trends,
  User,
  Radar,
} from "@/types/finnos";

const LOCAL_USER_ID = "local";

const LOCAL_NOTIFICATION_DISMISSED_KEY = "finnos:notification-dismissed";
const LOCAL_NOTIFY_PREFS_KEY = "finnos:notify-prefs";
const DEFAULT_NOTIFY_PREFS: NotifyPrefsInput = {
  push_enabled: true,
  email_enabled: false,
  hour: 9,
  days_before: 1,
  transaction_reminders: true,
  invoice_reminders: true,
  radar_alerts: true,
  activity_reminders: true,
  weekly_summary: true,
  system_notices: true,
};

function readLocalNotifyPrefs(): NotifyPrefsInput {
  try {
    return { ...DEFAULT_NOTIFY_PREFS, ...JSON.parse(localStorage.getItem(LOCAL_NOTIFY_PREFS_KEY) || "{}") };
  } catch {
    return DEFAULT_NOTIFY_PREFS;
  }
}



function localDismissedNotificationIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LOCAL_NOTIFICATION_DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveLocalDismissedNotificationIds(ids: Set<string>): void {
  localStorage.setItem(LOCAL_NOTIFICATION_DISMISSED_KEY, JSON.stringify([...ids]));
}


/** The signed-in identity, or the synthetic local-mode profile. */
export async function fetchMe(): Promise<User> {
  return loadSessionProfile(() => ({
      id: LOCAL_USER_ID,
      name: localGetProfile().name,
      email: "conta local (neste aparelho)",
      created_at: new Date().toISOString(),
      session_mode: getMode(),
      auth_provider: getMode(),
    }));
}

export async function updateMyName(name: string): Promise<User> {
  if (isLocalMode()) {
    const profile = localSetName(name);
    return { id: LOCAL_USER_ID, name: profile.name, email: "conta local (neste aparelho)", created_at: new Date().toISOString() };
  }
  return apiPatchName(name);
}

async function apiPatchName(name: string): Promise<User> {
  const { apiPatch } = await import("@/lib/api");
  return apiPatch<User>("/auth/me", { name });
}

// --- Dashboard --------------------------------------------------------------

function txAmount(tx: TransactionInput): number { return tx.adjusted_value ?? tx.value; }
function txInMonth(tx: TransactionInput, month: string): boolean { return tx.date.slice(0, 7) === month; }
function applyPendingToDashboard(base: Dashboard, pending: { id: string; payload: TransactionInput; createdAt: string }[]): Dashboard {
  const relevant = pending.filter((op) => txInMonth(op.payload, base.month) && op.payload.status === "pago");
  if (!relevant.length) return base;
  const income = relevant.filter((o) => o.payload.type === "receita").reduce((s,o)=>s+txAmount(o.payload),0);
  const expense = relevant.filter((o) => o.payload.type === "despesa").reduce((s,o)=>s+txAmount(o.payload),0);
  const recent: Transaction[] = relevant.map((o) => ({
    id: `offline:${o.id}`, ...o.payload, account_name: "Aguardando sincronização", card_name: null,
    to_account_name: null, category_name: null, category_color: null, category_icon: null,
    installment_value: o.payload.installment && o.payload.total_installments ? txAmount(o.payload) / o.payload.total_installments : null,
    created_at: o.createdAt,
  }));
  return { ...base, income: base.income + income, expense: base.expense + expense,
    month_balance: base.month_balance + income - expense, total_balance: base.total_balance + income - expense,
    recent: [...recent, ...base.recent].slice(0, Math.max(base.recent.length, 5)) };
}

export async function fetchDashboard(month: string | null): Promise<Dashboard> {
  if (isLocalMode()) return localDashboard(month);
  const base = await cachedFetch(`dashboard:${month ?? "current"}`, () => apiGet<Dashboard>(month ? `/dashboard?month=${month}` : "/dashboard"));
  const pending = (await listSyncOperations()).filter(isTransactionSyncOperation).filter((o) => o.kind === "transaction.create");
  return applyPendingToDashboard(base, pending);
}

// --- Radar ------------------------------------------------------------------

export async function fetchRadar(): Promise<Radar | null> {
  if (isLocalMode()) return localRadar();
  return cachedFetch("radar", () => apiGet<Radar>("/radar"));
}

export async function updateRadarSignal(signalId: string, action: "view" | "dismiss" | "resolve") {
  if (isLocalMode()) return { ok: true, state: action };
  return apiPost<{ ok: boolean; state: string }>(`/radar/${encodeURIComponent(signalId)}/action`, { action });
}

export async function sendRadarFeedback(signalId: string, feedback: "useful" | "not_useful" | "dont_show_similar") {
  if (isLocalMode()) return { ok: true };
  return apiPost<{ ok: boolean }>(`/radar/${encodeURIComponent(signalId)}/feedback`, { feedback });
}

// --- Analytics --------------------------------------------------------------

export async function fetchTrends(months: number, endMonth?: string): Promise<Trends> {
  if (isLocalMode()) return localTrends(months, endMonth);
  const params = new URLSearchParams({ months: String(months) });
  if (endMonth) params.set("end_month", endMonth);
  return cachedFetch(`trends:${params.toString()}`, () => apiGet<Trends>(`/analytics/trends?${params.toString()}`));
}

/** FIN-09 historical invoice review reads only the authenticated user's records.
 * A clean comparison is NOT proof of an earlier MongoDB migration.
 */
export async function fetchFinanceIntegrity(): Promise<FinanceIntegrity> {
  if (isLocalMode()) throw new Error("Auditoria Firestore não disponível no modo local.");
  return apiGet<FinanceIntegrity>("/finance/integrity");
}

/** FINN-inspired append-only financial audit history, read-only and UID-scoped. */
export async function fetchFinanceHistory(limit = 50, before?: string): Promise<FinanceHistoryPage> {
  if (isLocalMode()) return localFinanceHistory(limit, before);
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  return apiGet<FinanceHistoryPage>(`/finance/history?${params.toString()}`);
}

export async function fetchBudget(month: string): Promise<BudgetSummary> {
  if (isLocalMode()) return localBudget(month);
  return cachedFetch(`budget:${month}`, () => apiGet<BudgetSummary>(`/analytics/budget?month=${month}`));
}

export async function fetchFlow(params: FlowParams): Promise<Flow> {
  if (isLocalMode()) return localFlow(params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, String(value));
  }
  const base = await cachedFetch(`flow:${search.toString()}`, () => apiGet<Flow>(`/analytics/flow?${search.toString()}`));
  const pending = (await listSyncOperations()).filter(isTransactionSyncOperation).filter((o) => o.kind === "transaction.create" && o.payload.status === "pago");
  let incomeDelta = 0, expenseDelta = 0;
  const series = base.series.map((point) => {
    const ops = pending.filter((o) => o.payload.date.slice(0, 7) === point.month && (!params.category_id || o.payload.category_id === params.category_id));
    const income = ops.filter((o) => o.payload.type === "receita").reduce((s,o)=>s+txAmount(o.payload),0);
    const expense = ops.filter((o) => o.payload.type === "despesa").reduce((s,o)=>s+txAmount(o.payload),0);
    if (point.month === base.month) { incomeDelta += income; expenseDelta += expense; }
    return { ...point, income: point.income + income, expense: point.expense + expense, net: point.net + income - expense };
  });
  return { ...base, series, income: base.income + incomeDelta, expense: base.expense + expenseDelta,
    net: base.net + incomeDelta - expenseDelta,
    total_income: base.total_income + series.reduce((sum,p,i)=>sum + (p.income-base.series[i].income),0),
    total_expense: base.total_expense + series.reduce((sum,p,i)=>sum + (p.expense-base.series[i].expense),0),
    total_net: base.total_net + series.reduce((sum,p,i)=>sum + (p.net-base.series[i].net),0) };
}

export async function fetchCalendar(month: string): Promise<CalendarMonth> {
  if (isLocalMode()) return localCalendar(month);
  return cachedFetch(`calendar:${month}`, () => apiGet<CalendarMonth>(`/analytics/calendar?month=${month}`));
}


export async function fetchBudgetSuggestion(): Promise<BudgetSuggestion | null> {
  if (isLocalMode()) return null;
  return apiGet<BudgetSuggestion>("/budgets/suggestion");
}

export async function fetchCurrentBudgetCycle(): Promise<BudgetCycle | null> {
  if (isLocalMode()) return null;
  return apiGet<BudgetCycle | null>("/budgets/current");
}
export async function fetchNextBudgetCycle(): Promise<BudgetCycle | null> {
  if (isLocalMode()) return null;
  return apiGet<BudgetCycle | null>("/budgets/next");
}
export async function fetchBudgetCycles(): Promise<BudgetCycle[]> {
  if (isLocalMode()) return [];
  return apiGet<BudgetCycle[]>("/budgets");
}
export async function fetchBudgetCycleProgress(id: string): Promise<BudgetCycleProgress> {
  return apiGet<BudgetCycleProgress>(`/budgets/${id}/progress`);
}
export type BudgetCyclePayload = {
  mode: "503020" | "personalizado";
  period: "semanal" | "quinzenal" | "mensal" | "anual";
  start_date: string; end_date: string; expected_income: number;
  allocations: { category_id: string; planned: number; priority: "essencial" | "flexivel" | "meta"; rollover: boolean }[];
  extraordinary: boolean; notes?: string | null;
};
export async function createBudgetCycle(payload: BudgetCyclePayload): Promise<BudgetCycle> {
  return apiPost<BudgetCycle>("/budgets", payload);
}
export async function updateBudgetCycle(id: string, payload: BudgetCyclePayload): Promise<BudgetCycle> {
  return apiPut<BudgetCycle>(`/budgets/${id}`, payload);
}

// --- Institutions -----------------------------------------------------------

export async function fetchInstitutions(): Promise<Institution[]> {
  if (isLocalMode()) return localListInstitutions();
  try {
    return await cachedFetch("institutions", () => apiGet<Institution[]>("/institutions"));
  } catch (error) {
    // A legacy account can already have cached accounts but no institution catalog yet.
    // Offline fallback is display-only; never hide an online authentication/API error.
    if (!navigator.onLine && error instanceof Error && error.message === "FINNOS_OFFLINE_NO_CACHE") return [];
    throw error;
  }
}

export async function createInstitution(input: InstitutionInput): Promise<Institution> {
  if (isLocalMode()) return localCreateInstitution(input);
  return apiPost<Institution>("/institutions", input);
}

export async function deleteInstitution(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteInstitution(id);
  return apiDelete<void>(`/institutions/${encodeURIComponent(id)}`);
}

// --- Accounts ---------------------------------------------------------------

export async function fetchAccounts(): Promise<Account[]> {
  if (isLocalMode()) return localListAccounts();
  return cachedFetch("accounts", () => apiGet<Account[]>("/accounts"));
}

export async function fetchAccount(id: string): Promise<AccountDetail> {
  if (isLocalMode()) return localGetAccount(id);
  return cachedFetch(`account:${id}`, () => apiGet<AccountDetail>(`/accounts/${id}`));
}

export async function createAccount(input: AccountInput): Promise<Account> {
  if (isLocalMode()) return localCreateAccount(input);
  if (!navigator.onLine) {
    await queueEntityCreate("account.create", input);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPost<Account>("/accounts", input);
}

export async function updateAccount(id: string, input: AccountInput): Promise<Account> {
  if (isLocalMode()) return localUpdateAccount(id, input);
  if (!navigator.onLine) {
    const original = (await fetchAccounts()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da conta indisponível offline.");
    await queueEntityMutation("account.update", id, input, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPut<Account>(`/accounts/${encodeURIComponent(id)}`, input);
}

export async function deleteAccount(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteAccount(id);
  if (!navigator.onLine) {
    const original = (await fetchAccounts()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da conta indisponível offline.");
    await queueEntityMutation("account.delete", id, {
      name: original.name, institution: original.institution,
      institution_id: original.institution_id, type: original.type,
      color: original.color, initial_balance: original.initial_balance,
      active: original.active,
    }, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiDelete<void>(`/accounts/${encodeURIComponent(id)}`);
}

// --- Categories -------------------------------------------------------------

export async function fetchCategories(): Promise<Category[]> {
  if (isLocalMode()) return localListCategories();
  return cachedFetch("categories", () => apiGet<Category[]>("/categories"));
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  if (isLocalMode()) return localCreateCategory(input);
  if (!navigator.onLine) {
    await queueEntityCreate("category.create", input);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPost<Category>("/categories", input);
}

export async function updateCategory(id: string, input: CategoryInput): Promise<Category> {
  if (isLocalMode()) return localUpdateCategory(id, input);
  if (!navigator.onLine) {
    const original = (await fetchCategories()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da categoria indisponível offline.");
    await queueEntityMutation("category.update", id, input, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPut<Category>(`/categories/${encodeURIComponent(id)}`, input);
}

export async function deleteCategory(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteCategory(id);
  if (!navigator.onLine) {
    const original = (await fetchCategories()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da categoria indisponível offline.");
    await queueEntityMutation("category.delete", id, {
      name: original.name, icon: original.icon, color: original.color,
      group: original.group, monthly_budget: original.monthly_budget,
      monthly_goal: original.monthly_goal,
    }, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiDelete<void>(`/categories/${encodeURIComponent(id)}`);
}

// --- Transactions -----------------------------------------------------------

export async function fetchTransactions(filters: LocalTxFilters): Promise<Transaction[]> {
  if (isLocalMode()) return localListTransactions(filters);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const uid = firebaseAuth?.currentUser?.uid;
  const key = `transactions:${params.toString()}`;
  const base = await cachedFetch(key, () => apiGet<Transaction[]>(`/transactions?${params.toString()}`));
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (navigator.onLine && uid) await Promise.all(base.map(t => cacheSet(`firebase:${uid}:transaction:${t.id}`, t)));
  const operations = (await listSyncOperations()).filter(isTransactionSyncOperation);
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  const pending = operations.filter((o) => o.kind === "transaction.create");
  const updated = base.map(t => { const op = operations.filter(o => o.kind === "transaction.update" && o.entityId === t.id).at(-1); return op ? {...t,...op.payload} : t; });
  const optimistic: Transaction[] = pending
    .filter((o) => !filters.month || o.payload.date.slice(0, 7) === filters.month)
    .filter((o) => !filters.type || o.payload.type === filters.type)
    .filter((o) => !filters.category_id || o.payload.category_id === filters.category_id)
    .map((o) => ({ id: `offline:${o.id}`, ...o.payload, account_name: "Aguardando sincronização", card_name: null,
      to_account_name: null, category_name: null, category_color: null, category_icon: null,
      installment_value: o.payload.installment && o.payload.total_installments ? txAmount(o.payload) / o.payload.total_installments : null,
      created_at: o.createdAt }));
  return [...optimistic, ...updated];
}

/** ARQ-03 staged indexed pagination. The legacy list endpoint and its totals
 * remain untouched until all visual consumers migrate to paginated contracts.
 */
export async function fetchTransactionsPage(
  input: LocalTxFilters | string,
  cursor?: string,
  limit = 50,
  sortDir: "asc" | "desc" = "desc",
): Promise<TransactionPage> {
  const filters: LocalTxFilters = typeof input === "string" ? { month: input } : input;
  const hasMonth = Boolean(filters.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month));
  const hasRange = Boolean(filters.start_date && filters.end_date);
  const isDate = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
    && !Number.isNaN(Date.parse(value + "T12:00:00Z"))
    && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  if ((!hasMonth && !hasRange)
    || (filters.month && !hasMonth)
    || (Boolean(filters.start_date) !== Boolean(filters.end_date))
    || (hasRange && (!isDate(filters.start_date!) || !isDate(filters.end_date!)
      || filters.start_date! > filters.end_date!))
    || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Página financeira inválida.");
  }
  const params = new URLSearchParams({ limit: String(limit), sort_dir: sortDir });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  if (cursor) params.set("cursor", cursor);
  if (isLocalMode()) {
    const rows = localListTransactions(filters)
      .sort((a, b) => (sortDir === "desc"
        ? b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
        : a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
    const start = cursor ? rows.findIndex(row => row.id === cursor) + 1 : 0;
    if (cursor && start === 0) throw new Error("Cursor financeiro inválido.");
    const items = rows.slice(start, start + limit);
    return {
      month: filters.month ?? filters.start_date!.slice(0, 7),
      items,
      next_cursor: start + limit < rows.length ? items.at(-1)?.id ?? null : null,
    };
  }
  const uid = firebaseAuth?.currentUser?.uid;
  const result = await apiGet<TransactionPage>(`/transactions/page?${params.toString()}`);
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (navigator.onLine && uid) {
    await Promise.all(result.items.map(row =>
      cacheSet(`firebase:${uid}:transaction:${row.id}`, row)));
    if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  }
  return result;
}

export async function createTransaction(input: TransactionInput, source: OperationSource = "manual"): Promise<Transaction> {
  if (isLocalMode()) return localCreateTransaction(input);
  if (!navigator.onLine) {
    await queueTransaction(input, source);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPost<Transaction>("/transactions", input, { "X-FINNOS-Source": source });
}

export async function updateTransaction(id: string, input: TransactionInput, source: OperationSource = "manual"): Promise<Transaction> {
  if (isLocalMode()) return localUpdateTransaction(id, input);
  if (!navigator.onLine) {
    await queueTransaction(input, source, id);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPut<Transaction>(`/transactions/${id}`, input, { "X-FINNOS-Source": source });
}

export type RecurrenceEditScope = "esta" | "proximas" | "todas";

export async function editRecurrence(
  id: string,
  version: number,
  scope: RecurrenceEditScope,
  effective_date: string,
  changes: { name?: string; value?: number },
): Promise<Transaction> {
  if (isLocalMode()) throw new Error("Edição de séries requer conta sincronizada.");
  if (!navigator.onLine) throw new Error("Conecte-se para editar uma série recorrente. Nenhuma alteração foi perdida.");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Versão de recorrência indisponível.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(effective_date)) throw new Error("Data inválida.");
  const operationId = crypto.randomUUID();
  return apiPost<Transaction>(`/transactions/${encodeURIComponent(id)}/recurrence`, {
    scope, effective_date, changes,
  }, {
    "X-FINNOS-Operation-ID": operationId,
    "X-FINNOS-Base-Version": String(version),
  });
}

export { flushSyncQueue };

export async function deleteTransaction(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteTransaction(id);
  if (!navigator.onLine) {
    if (id.startsWith("offline:")) {
      throw new Error("Revise o lançamento ainda não sincronizado antes de excluí-lo.");
    }
    await queueTransactionDelete(id);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiDelete<void>(`/transactions/${encodeURIComponent(id)}`);
}

// --- Demo data --------------------------------------------------------------

export async function loadDemoData(): Promise<void> {
  if (isLocalMode()) return localLoadDemo();
  throw new Error("Demonstração disponível apenas no modo local. Nenhuma conta Firebase foi alterada.");
}

export async function clearMyData(): Promise<void> {
  if (isLocalMode()) return localClearData();
  throw new Error("A exclusão de dados da conta online exige um fluxo de recuperação e confirmação específico.");
}

// --- Cartões ---------------------------------------------------------------

export async function fetchCards(): Promise<CreditCard[]> {
  if (isLocalMode()) return localListCards();
  return cachedFetch("cards", () => apiGet<CreditCard[]>("/cards"));
}

export async function createCard(input: CardInput): Promise<CreditCard> {
  if (isLocalMode()) return localCreateCard(input);
  if (!navigator.onLine) {
    await queueEntityCreate("card.create", input);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPost<CreditCard>("/cards", input);
}

export async function updateCard(id: string, input: CardInput): Promise<CreditCard> {
  if (isLocalMode()) return localUpdateCard(id, input);
  if (!navigator.onLine) {
    const original = (await fetchCards()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão do cartão indisponível offline.");
    await queueEntityMutation("card.update", id, input, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPut<CreditCard>(`/cards/${encodeURIComponent(id)}`, input);
}

export async function deleteCard(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteCard(id);
  if (!navigator.onLine) {
    const original = (await fetchCards()).find(row => row.id === id);
    if (!original?.version) throw new Error("Versão do cartão indisponível offline.");
    await queueEntityMutation("card.delete", id, {
      name: original.name, institution: original.institution,
      institution_id: original.institution_id, color: original.color,
      limit: original.limit, closing_day: original.closing_day,
      due_day: original.due_day, payment_account_id: original.payment_account_id,
      active: original.active,
    }, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiDelete<void>(`/cards/${encodeURIComponent(id)}`);
}

// --- Notificações ----------------------------------------------------------

export async function fetchNotifications(): Promise<Notifications> {
  if (isLocalMode()) {
    const dismissed = localDismissedNotificationIds();
    const local = localNotifications();
    const items = local.items.filter((item) => !dismissed.has(item.id));
    return { items, count: items.length };
  }
  return cachedFetch("notifications", () => apiGet<Notifications>("/notifications"));
}

export async function dismissNotification(id: string): Promise<void> {
  if (isLocalMode()) {
    const dismissed = localDismissedNotificationIds();
    dismissed.add(id);
    saveLocalDismissedNotificationIds(dismissed);
    return;
  }
  await apiPost<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/dismiss`, {});
}

export async function clearNotifications(ids: string[]): Promise<void> {
  if (isLocalMode()) {
    const dismissed = localDismissedNotificationIds();
    ids.forEach((id) => dismissed.add(id));
    saveLocalDismissedNotificationIds(dismissed);
    return;
  }
  await apiPost<{ ok: boolean; count: number }>("/notifications/clear", { ids });
}

// --- Fatura / assinaturas / avisos -----------------------------------------

export async function fetchInvoice(cardId: string, cycle?: string): Promise<Invoice> {
  if (isLocalMode()) return localInvoice(cardId, cycle);
  const parameter = cycle ? `?cycle=${encodeURIComponent(cycle)}` : "";
  return cachedFetch(`invoice:${cardId}:${cycle ?? "default"}`, () => apiGet<Invoice>(`/cards/${cardId}/invoice${parameter}`));
}

export async function payInvoice(cardId: string, input: PayInvoiceInput, operationId = crypto.randomUUID()): Promise<Invoice> {
  if (isLocalMode()) return localPayInvoice(cardId, input);
  return apiPost<Invoice>(`/cards/${cardId}/pay`, input, { "X-FINNOS-Operation-ID": operationId });
}

/** Paid invoice refund creates one bank receipt; the original invoice remains paid. */
export async function refundInvoiceToBank(cardId: string, input: BankRefundInput, operationId = crypto.randomUUID()): Promise<Invoice> {
  if (isLocalMode()) return localBankRefund(cardId, input, operationId);
  return apiPost<Invoice>(`/cards/${encodeURIComponent(cardId)}/refunds`, input, { "X-FINNOS-Operation-ID": operationId });
}

/** Merchant credit reduces unpaid card debt; it never transfers money to a bank account. */
export async function creditInvoice(cardId: string, input: CreditInvoiceInput, operationId = crypto.randomUUID()): Promise<Invoice> {
  if (isLocalMode()) return localCreditInvoice(cardId, input, operationId);
  return apiPost<Invoice>(`/cards/${encodeURIComponent(cardId)}/credits`, input, { "X-FINNOS-Operation-ID": operationId });
}

export async function fetchSubscriptions(): Promise<Subscriptions> {
  if (isLocalMode()) return localSubscriptions();
  return cachedFetch("subscriptions:v2", () => apiGet<Subscriptions>("/subscriptions"));
}

export async function createSubscription(input: SubscriptionInput): Promise<SubscriptionItem> {
  if (isLocalMode()) return localCreateSubscription(input);
  if (!navigator.onLine) {
    await queueEntityCreate("subscription.create", input);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPost<SubscriptionItem>("/subscriptions", input);
}

export async function updateSubscription(id: string, input: SubscriptionInput): Promise<SubscriptionItem> {
  if (isLocalMode()) return localUpdateSubscription(id, input);
  if (!navigator.onLine) {
    const original = (await fetchSubscriptions()).items.find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da assinatura indisponível offline.");
    await queueEntityMutation("subscription.update", id, input, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  return apiPut<SubscriptionItem>(`/subscriptions/${encodeURIComponent(id)}`, input);
}

export async function deleteSubscription(id: string): Promise<void> {
  if (isLocalMode()) {
    localDeleteSubscription(id);
    return;
  }
  if (!navigator.onLine) {
    const original = (await fetchSubscriptions()).items.find(row => row.id === id);
    if (!original?.version) throw new Error("Versão da assinatura indisponível offline.");
    await queueEntityMutation("subscription.delete", id, {
      name: original.name, value: original.value, recurrence: original.recurrence,
      next_charge: original.next_charge, account_id: original.account_id,
      category_id: original.category_id, card_id: original.card_id,
      active: original.active, notes: original.notes,
    }, original.version);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  await apiDelete<void>(`/subscriptions/${encodeURIComponent(id)}`);
}

/** Reminder settings live on the server, so local mode reports them as unavailable. */
export async function fetchNotifyPrefs(): Promise<NotifyPrefs> {
  if (isLocalMode()) {
    return { ...readLocalNotifyPrefs(), push_devices: 1, push_supported: true };
  }
  return apiGet<NotifyPrefs>("/push/prefs");
}

export async function saveNotifyPrefs(input: NotifyPrefsInput): Promise<NotifyPrefs> {
  if (isLocalMode()) {
    localStorage.setItem(LOCAL_NOTIFY_PREFS_KEY, JSON.stringify(input));
    return { ...input, push_devices: 1, push_supported: true };
  }
  return apiPut<NotifyPrefs>("/push/prefs", input);
}

export async function sendTestPush(): Promise<{ sent: number }> {
  if (isLocalMode()) {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || Notification.permission !== "granted") {
      throw new Error("Ative as notificações neste aparelho antes de enviar o teste.");
    }
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("FINNOS · Notificação de teste", {
      body: "Tudo certo. Este aparelho está pronto para receber avisos do FINNOS.",
      icon: "/brand/finnos-icon.png",
      badge: "/brand/finnos-icon.png",
      tag: "finnos-test",
      data: { url: "/configuracoes" },
    });
    return { sent: 1 };
  }
  return apiPost<{ sent: number }>("/push/test", {});
}
