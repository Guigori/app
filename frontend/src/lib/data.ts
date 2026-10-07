// Single data boundary for the whole app. Every page/dialog calls these helpers so
// "conta local" (browser-only) and "conta completa" (server) share one call shape:
// in account mode they hit /api via src/lib/api.ts, in local mode the browser engine.

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { localRadar } from "@/lib/local/radar";
import { isLocalMode } from "@/lib/mode";
import { queueTransaction, flushSyncQueue, type OperationSource } from "@/lib/sync/queue";
import { cachedFetch } from "@/lib/offline/accountCache";
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
  if (isLocalMode()) {
    return {
      id: LOCAL_USER_ID,
      name: localGetProfile().name,
      email: "conta local (neste aparelho)",
      created_at: new Date().toISOString(),
    };
  }
  return cachedFetch("me", () => apiGet<User>("/auth/me"));
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
  return cachedFetch(`dashboard:${month ?? "current"}`, () => apiGet<Dashboard>(month ? `/dashboard?month=${month}` : "/dashboard"));
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
  return cachedFetch(`flow:${search.toString()}`, () => apiGet<Flow>(`/analytics/flow?${search.toString()}`));
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
  return cachedFetch("categories", () => apiGet<Category[]>("/categories"));
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
  return cachedFetch(`transactions:${params.toString()}`, () => apiGet<Transaction[]>(`/transactions?${params.toString()}`));
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

export { flushSyncQueue };

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
  return cachedFetch("cards", () => apiGet<CreditCard[]>("/cards"));
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

export async function fetchInvoice(cardId: string): Promise<Invoice> {
  if (isLocalMode()) return localInvoice(cardId);
  return cachedFetch(`invoice:${cardId}`, () => apiGet<Invoice>(`/cards/${cardId}/invoice`));
}

export async function payInvoice(cardId: string, input: PayInvoiceInput): Promise<Invoice> {
  if (isLocalMode()) return localPayInvoice(cardId, input);
  return apiPost<Invoice>(`/cards/${cardId}/pay`, input);
}

export async function fetchSubscriptions(): Promise<Subscriptions> {
  if (isLocalMode()) return localSubscriptions();
  return cachedFetch("subscriptions", () => apiGet<Subscriptions>("/subscriptions"));
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
