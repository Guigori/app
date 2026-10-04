// Single data boundary for the whole app. Every page/dialog calls these helpers so
// "conta local" (browser-only) and "conta completa" (server) share one call shape:
// in account mode they hit /api via src/lib/api.ts, in local mode the browser engine.

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import {
  localClearData,
  localCreateAccount,
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
  localSubscriptions,
  localCalendar,
  type LocalTxFilters,
} from "@/lib/local/engine";
import type {
  Account,
  AccountDetail,
  AccountInput,
  BudgetSummary,
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
  Subscriptions,
  Category,
  CategoryInput,
  Dashboard,
  Flow,
  FlowParams,
  Transaction,
  TransactionInput,
  Trends,
  User,
  Radar,
} from "@/types/finnos";

const LOCAL_USER_ID = "local";

/** The signed-in identity, or the synthetic local-mode profile. */
export async function fetchMe(): Promise<User> {
  if (isLocalMode()) {
    return {
      id: LOCAL_USER_ID,
      name: localGetProfile().name,
      email: "conta local (neste aparelho)",
      created_at: new Date().toISOString(),
    };
  }
  return apiGet<User>("/auth/me");
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

export async function fetchDashboard(month: string | null): Promise<Dashboard> {
  if (isLocalMode()) return localDashboard(month);
  return apiGet<Dashboard>(month ? `/dashboard?month=${month}` : "/dashboard");
}

// --- Radar ------------------------------------------------------------------

export async function fetchRadar(): Promise<Radar | null> {
  if (isLocalMode()) return null;
  return apiGet<Radar>("/radar");
}

// --- Analytics --------------------------------------------------------------

export async function fetchTrends(months: number, endMonth?: string): Promise<Trends> {
  if (isLocalMode()) return localTrends(months, endMonth);
  const params = new URLSearchParams({ months: String(months) });
  if (endMonth) params.set("end_month", endMonth);
  return apiGet<Trends>(`/analytics/trends?${params.toString()}`);
}

export async function fetchBudget(month: string): Promise<BudgetSummary> {
  if (isLocalMode()) return localBudget(month);
  return apiGet<BudgetSummary>(`/analytics/budget?month=${month}`);
}

export async function fetchFlow(params: FlowParams): Promise<Flow> {
  if (isLocalMode()) return localFlow(params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, String(value));
  }
  return apiGet<Flow>(`/analytics/flow?${search.toString()}`);
}

export async function fetchCalendar(month: string): Promise<CalendarMonth> {
  if (isLocalMode()) return localCalendar(month);
  return apiGet<CalendarMonth>(`/analytics/calendar?month=${month}`);
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

// --- Accounts ---------------------------------------------------------------

export async function fetchAccounts(): Promise<Account[]> {
  if (isLocalMode()) return localListAccounts();
  return apiGet<Account[]>("/accounts");
}

export async function fetchAccount(id: string): Promise<AccountDetail> {
  if (isLocalMode()) return localGetAccount(id);
  return apiGet<AccountDetail>(`/accounts/${id}`);
}

export async function createAccount(input: AccountInput): Promise<Account> {
  if (isLocalMode()) return localCreateAccount(input);
  return apiPost<Account>("/accounts", input);
}

export async function updateAccount(id: string, input: AccountInput): Promise<Account> {
  if (isLocalMode()) return localUpdateAccount(id, input);
  return apiPut<Account>(`/accounts/${id}`, input);
}

export async function deleteAccount(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteAccount(id);
  return apiDelete<void>(`/accounts/${id}`);
}

// --- Categories -------------------------------------------------------------

export async function fetchCategories(): Promise<Category[]> {
  if (isLocalMode()) return localListCategories();
  return apiGet<Category[]>("/categories");
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  if (isLocalMode()) return localCreateCategory(input);
  return apiPost<Category>("/categories", input);
}

export async function updateCategory(id: string, input: CategoryInput): Promise<Category> {
  if (isLocalMode()) return localUpdateCategory(id, input);
  return apiPut<Category>(`/categories/${id}`, input);
}

export async function deleteCategory(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteCategory(id);
  return apiDelete<void>(`/categories/${id}`);
}

// --- Transactions -----------------------------------------------------------

export async function fetchTransactions(filters: LocalTxFilters): Promise<Transaction[]> {
  if (isLocalMode()) return localListTransactions(filters);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  return apiGet<Transaction[]>(`/transactions?${params.toString()}`);
}

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  if (isLocalMode()) return localCreateTransaction(input);
  return apiPost<Transaction>("/transactions", input);
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
  if (isLocalMode()) return localUpdateTransaction(id, input);
  return apiPut<Transaction>(`/transactions/${id}`, input);
}

export async function deleteTransaction(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteTransaction(id);
  return apiDelete<void>(`/transactions/${id}`);
}

// --- Demo data --------------------------------------------------------------

export async function loadDemoData(): Promise<void> {
  if (isLocalMode()) return localLoadDemo();
  await apiPost<{ ok: boolean }>("/demo/load");
}

export async function clearMyData(): Promise<void> {
  if (isLocalMode()) return localClearData();
  await apiPost<{ ok: boolean }>("/demo/clear");
}

// --- Cartões ---------------------------------------------------------------

export async function fetchCards(): Promise<CreditCard[]> {
  if (isLocalMode()) return localListCards();
  return apiGet<CreditCard[]>("/cards");
}

export async function createCard(input: CardInput): Promise<CreditCard> {
  if (isLocalMode()) return localCreateCard(input);
  return apiPost<CreditCard>("/cards", input);
}

export async function updateCard(id: string, input: CardInput): Promise<CreditCard> {
  if (isLocalMode()) return localUpdateCard(id, input);
  return apiPut<CreditCard>(`/cards/${id}`, input);
}

export async function deleteCard(id: string): Promise<void> {
  if (isLocalMode()) return localDeleteCard(id);
  return apiDelete<void>(`/cards/${id}`);
}

// --- Notificações ----------------------------------------------------------

export async function fetchNotifications(): Promise<Notifications> {
  if (isLocalMode()) return localNotifications();
  return apiGet<Notifications>("/notifications");
}

// --- Fatura / assinaturas / avisos -----------------------------------------

export async function fetchInvoice(cardId: string): Promise<Invoice> {
  if (isLocalMode()) return localInvoice(cardId);
  return apiGet<Invoice>(`/cards/${cardId}/invoice`);
}

export async function payInvoice(cardId: string, input: PayInvoiceInput): Promise<Invoice> {
  if (isLocalMode()) return localPayInvoice(cardId, input);
  return apiPost<Invoice>(`/cards/${cardId}/pay`, input);
}

export async function fetchSubscriptions(): Promise<Subscriptions> {
  if (isLocalMode()) return localSubscriptions();
  return apiGet<Subscriptions>("/subscriptions");
}

/** Reminder settings live on the server, so local mode reports them as unavailable. */
export async function fetchNotifyPrefs(): Promise<NotifyPrefs> {
  if (isLocalMode()) {
    return { push_enabled: false, email_enabled: false, hour: 9, days_before: 1, push_devices: 0, push_supported: false };
  }
  return apiGet<NotifyPrefs>("/push/prefs");
}

export async function saveNotifyPrefs(input: NotifyPrefsInput): Promise<NotifyPrefs> {
  if (isLocalMode()) throw new Error("Os avisos exigem uma conta FINNOS (não funcionam no modo local).");
  return apiPut<NotifyPrefs>("/push/prefs", input);
}

export async function sendTestPush(): Promise<{ sent: number }> {
  if (isLocalMode()) throw new Error("Os avisos exigem uma conta FINNOS (não funcionam no modo local).");
  return apiPost<{ sent: number }>("/push/test", {});
}
