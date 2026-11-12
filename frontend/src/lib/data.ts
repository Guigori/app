import { INSTITUTION_CATALOG } from "@/lib/institutionCatalog";
import { firebaseAuth } from "@/lib/firebase";
// Single data boundary for the whole app. Every page/dialog calls these helpers so
// "conta local" (browser-only) and "conta completa" (server) share one call shape:
// in account mode they hit /api via src/lib/api.ts, in local mode the browser engine.

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { isISODate } from "@/lib/format";
import { localRadar } from "@/lib/local/radar";
import { isLocalMode, getMode } from "@/lib/mode";
import { loadSessionProfile } from "@/lib/profileIdentity";
import { queueTransaction, queueTransactionDelete, queueEntityCreate, queueEntityMutation, flushSyncQueue, listSyncOperations, isTransactionSyncOperation, type OperationSource } from "@/lib/sync/queue";
import { cacheGet, cacheSet, cachedFetch } from "@/lib/offline/accountCache";
import { withIntent } from "@/lib/sync/intent";
import {
  localFinanceHistory,
  localClearData,
  localCreateAccount,
  localListInstitutions,
  localCreateInstitution,
  localDeleteInstitution,
  localLinkLegacyInstitutions,
  localSetDefaultAccount,
  localSetDefaultCard,
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
  localTransactionHistory,
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
  localUndoInvoicePayment,
  localReverseTransfer,
  localCreateReconciliation, localListReconciliations, localGetReconciliation, localResolveReconciliation,
  localUndoReconciliationEvent, localCompleteReconciliation, localAdjustBalance,
  localCreateCardReconciliation, localListCardReconciliations,
  localCreditInvoice,
  localBankRefund,
  localSubscriptions,
  localCreateSubscription,
  localUpdateSubscription,
  localDeleteSubscription,
  localCalendar,
  localBalanceHistory,
  type LocalTxFilters,
} from "@/lib/local/engine";
import type {
  Reconciliation, ReconciliationInput, ReconResolveInput, BalanceAdjustment, BalanceAdjustmentInput, CardReconciliationInput,
  ConfirmAllResult,
  PendingCaptureConfirm,
  PendingCaptures,
  PendingSettings,
  Account,
  AccountDetail,
  AccountInput,
  Institution,
  InstitutionInput,
  InstitutionCatalogItem,
  LegacyLinkResult,
  FinanceHistoryPage,
  FinanceIntegrity,
  FiintMaturity,
  BudgetSummary,
  BudgetSuggestion,
  BudgetCycle,
  BudgetCycleProgress,
  BalanceHistory,
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
export async function fetchFiintMaturity(): Promise<FiintMaturity> {
  if (isLocalMode()) throw new Error("FIINT precisa de histórico autenticado e reconciliado.");
  return apiGet<FiintMaturity>("/finance/fiint");
}

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
    const ops = pending.filter((o) => o.payload.date.slice(0, 7) === point.month && (!params.category_id || o.payload.category_id === params.category_id) && (!params.account_id || o.payload.account_id === params.account_id));
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

/** Saldo das contas dia a dia no mês (a linha "Saldo" do gráfico do Início). */
export async function fetchBalanceHistory(month: string): Promise<BalanceHistory> {
  if (isLocalMode()) return localBalanceHistory(month);
  return cachedFetch(`balance-history:${month}`, () => apiGet<BalanceHistory>(`/analytics/balance-history?month=${month}`));
}

export async function fetchCalendar(month: string, categoryId?: string): Promise<CalendarMonth> {
  if (isLocalMode()) return localCalendar(month, categoryId);
  const category = categoryId ? `&category_id=${encodeURIComponent(categoryId)}` : "";
  return cachedFetch(`calendar:${month}${categoryId ? `:${categoryId}` : ""}`, () => apiGet<CalendarMonth>(`/analytics/calendar?month=${month}${category}`));
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

/** Known banks and benefit providers for the picker. */
export async function fetchInstitutionCatalog(): Promise<InstitutionCatalogItem[]> {
  if (isLocalMode()) return INSTITUTION_CATALOG;
  try {
    return await cachedFetch("institution-catalog", () => apiGet<InstitutionCatalogItem[]>("/institutions/catalog"));
  } catch {
    // The list is fixed; the bundled copy is the same one the server keeps.
    return INSTITUTION_CATALOG;
  }
}

/** Link older accounts and cards that only carry the bank name as text (idempotent). */
export async function linkLegacyInstitutions(): Promise<LegacyLinkResult> {
  if (isLocalMode()) return localLinkLegacyInstitutions();
  return apiPost<LegacyLinkResult>("/institutions/link-legacy", {});
}

/** Preselect this account for its kind (bank, benefit or cash); the previous one is unset. */
export async function setDefaultAccount(id: string): Promise<Account> {
  if (isLocalMode()) return localSetDefaultAccount(id);
  return apiPost<Account>(`/accounts/${encodeURIComponent(id)}/default`, {});
}

/** Preselect this credit card; the previous one is unset. */
export async function setDefaultCard(id: string): Promise<CreditCard> {
  if (isLocalMode()) return localSetDefaultCard(id);
  return apiPost<CreditCard>(`/cards/${encodeURIComponent(id)}/default`, {});
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
  return withIntent(firebaseAuth?.currentUser?.uid ?? "session", "account:create", input, (operationId) =>
    apiPost<Account>("/accounts", input, { "X-FINNOS-Operation-ID": operationId }));
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
  return withIntent(firebaseAuth?.currentUser?.uid ?? "session", "category:create", input, (operationId) =>
    apiPost<Category>("/categories", input, { "X-FINNOS-Operation-ID": operationId }));
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

/** One lançamento by id (a Radar signal points at it); null when it no longer exists. */
export async function fetchTransaction(id: string): Promise<Transaction | null> {
  if (isLocalMode()) return localListTransactions({}).find((tx) => tx.id === id) ?? null;
  try {
    return await apiGet<Transaction>(`/transactions/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

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
  // The legacy endpoint returns the whole filtered list.
  if (navigator.onLine && uid) await cacheSet(`firebase:${uid}:complete:${key}`, true);
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
    // AUD-07: accumulate the pages already seen into the snapshot the offline
    // list reads, marking whether every page was loaded. A partial list is
    // shown offline as partial, never as the complete month.
    const listParams = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value) listParams.set(name, String(value));
    const listKey = `firebase:${uid}:transactions:${listParams.toString()}`;
    const pagesKey = `firebase:${uid}:pages:${sortDir}:${listParams.toString()}`;
    const seen = cursor ? await cacheGet<Transaction[]>(pagesKey) : [];
    if (seen) {
      const items = [...seen, ...result.items.filter(row => !seen.some(old => old.id === row.id))];
      await cacheSet(pagesKey, items);
      await cacheSet(listKey, items);
      await cacheSet(`firebase:${uid}:complete:transactions:${listParams.toString()}`, !result.next_cursor);
    }
    if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  }
  return result;
}

/** Whether the offline snapshot of this filtered list holds every record
 * (true), only the pages loaded online (false) or is unknown (null). */
export async function isTransactionListComplete(filters: LocalTxFilters): Promise<boolean | null> {
  if (isLocalMode()) return true;
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) return null;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, String(value));
  return cacheGet<boolean>(`firebase:${uid}:complete:transactions:${params.toString()}`);
}

export async function createTransaction(input: TransactionInput, source: OperationSource = "manual"): Promise<Transaction> {
  if (isLocalMode()) return localCreateTransaction(input);
  if (!navigator.onLine) {
    await queueTransaction(input, source);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  const uid = firebaseAuth?.currentUser?.uid ?? "session";
  return withIntent(uid, "transaction:create", input, (operationId) =>
    apiPost<Transaction>("/transactions", input, { "X-FINNOS-Source": source, "X-FINNOS-Operation-ID": operationId }));
}

/** `baseVersion` is the version the user started editing from: the server answers
 * 409 instead of silently overwriting a newer change made elsewhere (AUD-05). */
export async function updateTransaction(id: string, input: TransactionInput, source: OperationSource = "manual", baseVersion?: number): Promise<Transaction> {
  if (isLocalMode()) return localUpdateTransaction(id, input);
  if (!navigator.onLine) {
    await queueTransaction(input, source, id);
    throw new Error("FINNOS_OFFLINE_QUEUED");
  }
  const uid = firebaseAuth?.currentUser?.uid ?? "session";
  return withIntent(uid, `transaction:update:${id}:${baseVersion ?? "?"}`, input, (operationId) =>
    apiPut<Transaction>(`/transactions/${id}`, input, {
      "X-FINNOS-Source": source, "X-FINNOS-Operation-ID": operationId,
      ...(Number.isSafeInteger(baseVersion) && (baseVersion as number) >= 1 ? { "X-FINNOS-Base-Version": String(baseVersion) } : {}),
    }));
}

export type RecurrenceEditScope = "esta" | "proximas" | "todas";

export async function editRecurrence(
  id: string,
  version: number,
  scope: RecurrenceEditScope,
  effective_date: string,
  changes: { name?: string; value?: number },
  operationId: string,
): Promise<Transaction> {
  if (isLocalMode()) throw new Error("Edição de séries requer conta sincronizada.");
  if (!navigator.onLine) throw new Error("Conecte-se para editar uma série recorrente. Nenhuma alteração foi perdida.");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Versão de recorrência indisponível.");
  if (!isISODate(effective_date)) throw new Error("Data inválida.");
  if (!operationId) throw new Error("Identificador de edição inválido.");
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
  return withIntent(firebaseAuth?.currentUser?.uid ?? "session", "card:create", input, (operationId) =>
    apiPost<CreditCard>("/cards", input, { "X-FINNOS-Operation-ID": operationId }));
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

/** Purchases the Apple Pay Shortcut left waiting. They live on the server, so only full accounts have them. */
export async function fetchPendingCaptures(): Promise<PendingCaptures> {
  if (isLocalMode()) return { items: [], count: 0 };
  return apiGet<PendingCaptures>("/pending-captures");
}

export async function confirmPendingCapture(id: string, input: PendingCaptureConfirm): Promise<{ ok: boolean; transaction_id: string }> {
  return apiPost<{ ok: boolean; transaction_id: string }>(`/pending-captures/${encodeURIComponent(id)}/confirm`, input);
}

export async function fetchTransactionById(id: string): Promise<Transaction> {
  return apiGet<Transaction>(`/transactions/${encodeURIComponent(id)}`);
}

/** The editable fields of a saved lançamento, ready to send back (with any changes on top). */
export function transactionInput(tx: Transaction, patch: Partial<TransactionInput> = {}): TransactionInput {
  return {
    name: tx.name, value: tx.value, type: tx.type, status: tx.status, date: tx.date, account_id: tx.account_id, card_id: tx.card_id,
    to_account_id: tx.to_account_id, category_id: tx.category_id, fixed: tx.fixed, recurrence: tx.recurrence, installment: tx.installment,
    total_installments: tx.total_installments, current_installment: tx.current_installment, adjusted_value: tx.adjusted_value,
    attachment: tx.attachment, notes: tx.notes, origin: tx.origin ?? null, notify_enabled: tx.notify_enabled ?? true, ...patch,
  };
}

/** Marks a scheduled or pending lançamento as paid; a future date becomes today, since it was paid now. */
export async function settleTransaction(tx: Transaction): Promise<Transaction> {
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return updateTransaction(tx.id, transactionInput(tx, { status: "pago", date: tx.date > iso ? iso : tx.date }), "manual", tx.version);
}

/** Adds the receipt photo to a saved lançamento and returns it as stored now. */
export async function addTransactionPhoto(tx: Transaction, file: File): Promise<Transaction> {
  const { attachPhoto, ATTACHMENT_MARKER } = await import("@/lib/attachments");
  await attachPhoto(tx, file);
  if (isLocalMode()) return updateTransaction(tx.id, transactionInput(tx, { attachment: ATTACHMENT_MARKER }), "manual", tx.version);
  return fetchTransactionById(tx.id);
}

/** Removes the receipt photo. */
export async function removeTransactionPhoto(tx: Transaction): Promise<Transaction> {
  const { removeAttachment } = await import("@/lib/attachments");
  await removeAttachment(tx.id);
  if (isLocalMode()) return updateTransaction(tx.id, transactionInput(tx, { attachment: null }), "manual", tx.version);
  return fetchTransactionById(tx.id);
}

export interface HistoryEvent { id: string; action: "created" | "updated" | "deleted"; created_at: string; before: Record<string, string | number> | null; after: Record<string, string | number> | null }
/** Every recorded change of one lançamento, newest first. */
export async function fetchTransactionHistory(id: string): Promise<HistoryEvent[]> {
  if (isLocalMode()) return (localTransactionHistory(id).items as unknown as HistoryEvent[]);
  return (await apiGet<{ items: HistoryEvent[] }>(`/transactions/${encodeURIComponent(id)}/history`)).items;
}

export async function confirmAllPendingCaptures(): Promise<ConfirmAllResult> {
  return apiPost<ConfirmAllResult>("/pending-captures/confirm-all", {});
}

/** A fake purchase: shows the Shortcut-to-FINNOS path works without paying anything. */
export async function createTestCapture(): Promise<{ ok: boolean; id: string }> {
  return apiPost<{ ok: boolean; id: string }>("/pending-captures/test", {});
}

export async function fetchPendingSettings(): Promise<PendingSettings> {
  return apiGet<PendingSettings>("/pending-captures/settings");
}

export async function savePendingSettings(input: Partial<PendingSettings>): Promise<PendingSettings> {
  return apiPut<PendingSettings>("/pending-captures/settings", input);
}

/** Takes back a purchase registered on its own: it is pending again and FINNOS forgets that combination. */
export async function undoAutoCapture(id: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/pending-captures/auto/${encodeURIComponent(id)}/undo`, {});
}

/** "Está certo": keeps the purchase registered on its own and takes it off the list. */
export async function keepAutoCapture(id: string): Promise<void> {
  await apiDelete<void>(`/pending-captures/auto/${encodeURIComponent(id)}`);
}

export async function discardPendingCapture(id: string): Promise<void> {
  await apiDelete<void>(`/pending-captures/${encodeURIComponent(id)}`);
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

// --- Conferência da conta com o extrato (etapa 3) ---
export async function createReconciliation(accountId: string, input: ReconciliationInput, operationId = crypto.randomUUID()): Promise<Reconciliation> {
  if (isLocalMode()) return localCreateReconciliation(accountId, input);
  return apiPost<Reconciliation>(`/accounts/${encodeURIComponent(accountId)}/reconciliations`, input, { "X-FINNOS-Operation-ID": operationId });
}
export async function fetchAccountReconciliations(accountId: string): Promise<Reconciliation[]> {
  if (isLocalMode()) return localListReconciliations(accountId);
  return apiGet<Reconciliation[]>(`/accounts/${encodeURIComponent(accountId)}/reconciliations`);
}
export async function fetchReconciliation(id: string): Promise<Reconciliation> {
  if (isLocalMode()) return localGetReconciliation(id);
  return apiGet<Reconciliation>(`/reconciliations/${encodeURIComponent(id)}`);
}
export async function resolveReconciliation(id: string, input: ReconResolveInput, operationId = crypto.randomUUID()): Promise<Reconciliation> {
  if (isLocalMode()) return localResolveReconciliation(id, input);
  return apiPost<Reconciliation>(`/reconciliations/${encodeURIComponent(id)}/resolve`, input, { "X-FINNOS-Operation-ID": operationId });
}
export async function undoReconciliationEvent(id: string, eventId: string, operationId = crypto.randomUUID()): Promise<Reconciliation> {
  if (isLocalMode()) return localUndoReconciliationEvent(id, eventId);
  return apiPost<Reconciliation>(`/reconciliations/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/undo`, {}, { "X-FINNOS-Operation-ID": operationId });
}
export async function completeReconciliation(id: string, note = ""): Promise<Reconciliation> {
  if (isLocalMode()) return localCompleteReconciliation(id, note);
  return apiPost<Reconciliation>(`/reconciliations/${encodeURIComponent(id)}/complete`, { note });
}
export async function createCardReconciliation(cardId: string, input: CardReconciliationInput, operationId = crypto.randomUUID()): Promise<Reconciliation> {
  if (isLocalMode()) return localCreateCardReconciliation(cardId, input);
  return apiPost<Reconciliation>(`/cards/${encodeURIComponent(cardId)}/reconciliations`, input, { "X-FINNOS-Operation-ID": operationId });
}
export async function fetchCardReconciliations(cardId: string): Promise<Reconciliation[]> {
  if (isLocalMode()) return localListCardReconciliations(cardId);
  return apiGet<Reconciliation[]>(`/cards/${encodeURIComponent(cardId)}/reconciliations`);
}
export async function adjustAccountBalance(accountId: string, input: BalanceAdjustmentInput, operationId = crypto.randomUUID()): Promise<BalanceAdjustment> {
  if (isLocalMode()) return localAdjustBalance(accountId, input);
  return apiPost<BalanceAdjustment>(`/accounts/${encodeURIComponent(accountId)}/adjustments`, input, { "X-FINNOS-Operation-ID": operationId });
}

/** Undo a transfer with an inverse transfer linked to it; the original stays in the history. */
export async function reverseTransfer(id: string, allowOverdraft = false, operationId = crypto.randomUUID()): Promise<Transaction> {
  if (isLocalMode()) return localReverseTransfer(id, allowOverdraft);
  return apiPost<Transaction>(`/transactions/${encodeURIComponent(id)}/reverse`, { allow_overdraft: allowOverdraft }, { "X-FINNOS-Operation-ID": operationId });
}

/** Undo the last payment of an invoice: a linked reversal returns the money; the original stays. */
export async function undoInvoicePayment(cardId: string, paymentId: string, operationId = crypto.randomUUID()): Promise<Invoice> {
  if (isLocalMode()) return localUndoInvoicePayment(cardId, paymentId);
  return apiPost<Invoice>(`/cards/${encodeURIComponent(cardId)}/payments/${encodeURIComponent(paymentId)}/undo`, {}, { "X-FINNOS-Operation-ID": operationId });
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

/** Origin labels used before ("Mercado Pago", "iFood"), most recent first. */
export async function fetchOrigins(): Promise<{ label: string; count: number }[]> {
  if (isLocalMode() || !navigator.onLine) return [];
  try { return (await apiGet<{ items: { label: string; count: number }[] }>("/transactions/origins")).items; } catch { return []; }
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
  return withIntent(firebaseAuth?.currentUser?.uid ?? "session", "subscription:create", input, (operationId) =>
    apiPost<SubscriptionItem>("/subscriptions", input, { "X-FINNOS-Operation-ID": operationId }));
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
      active: original.active, notes: original.notes ?? null,
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
