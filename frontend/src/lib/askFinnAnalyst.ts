/** Gathers the user's data (local or online, through lib/data) and lets the analyst answer. */
import {
  fetchAccounts, fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCards, fetchCategories,
  fetchCurrentBudgetCycle, fetchFlow, fetchRadar, fetchSubscriptions, fetchTransactions,
} from "@/lib/data";
import { addMonth, todayISO } from "@/lib/format";
import { norm, parseQuestion, type FinnQuery } from "@/lib/finnQuestion";
import { answer, type FinnAnswer } from "@/lib/finnAnalyst";
import type { FinnMessage } from "@/lib/aiConversations";

const safe = async <T,>(work: Promise<T>): Promise<T | null> => { try { return await work; } catch { return null; } };

/** Questions the older paths answer better: purchase simulations and the 50/30/20 rule. */
const HANDLED_ELSEWHERE = /\b(posso comprar|consigo comprar|da pra comprar|cabe no|parcel|50\/30\/20|503020|regra)\b/;

/**
 * Answers with the user's data, or null when the question is outside what the analyst
 * understands (then a language model, or the older assistant, may take it).
 */
export async function askFinnAnalyst(text: string, history: FinnMessage[], aliases: Record<string, string> = {}): Promise<FinnAnswer | null> {
  const q = norm(text);
  if (HANDLED_ELSEWHERE.test(q)) return null;
  const today = todayISO();
  const month = today.slice(0, 7);
  const recentStart = `${addMonth(month, -5)}-01`;
  const [categories, accounts, cards, recent] = await Promise.all([
    safe(fetchCategories()), safe(fetchAccounts()), safe(fetchCards()),
    safe(fetchTransactions({ start_date: recentStart, end_date: `${month}-31` })),
  ]);
  const previous = [...history].reverse().find((m) => m.role === "assistant" && m.query)?.query ?? null;
  const query: FinnQuery = parseQuestion(text, {
    today,
    categories: categories ?? [],
    accounts: accounts ?? [],
    cards: cards ?? [],
    names: [...new Set((recent ?? []).map((tx) => norm(tx.name)))],
    aliases,
  }, previous);
  if (query.vague) return null;

  // One read covers the period, the one it is compared with and the trend window.
  const start = [query.previous.start, query.period.start, recentStart].sort()[0];
  const end = [query.period.end, `${month}-31`].sort().at(-1)!;
  const transactions = start < recentStart || end > `${month}-31`
    ? await safe(fetchTransactions({ start_date: start, end_date: end })) ?? recent ?? []
    : recent ?? [];
  const wants = (ops: FinnQuery["op"][]) => ops.includes(query.op);
  const cycleMeta = wants(["budget"]) ? await safe(fetchCurrentBudgetCycle()) : null;
  const [budget, cycle, calendar, flow, subscriptions, radar] = await Promise.all([
    wants(["budget"]) ? safe(fetchBudget(month)) : null,
    cycleMeta?.id ? safe(fetchBudgetCycleProgress(cycleMeta.id)) : null,
    wants(["forecast"]) ? safe(fetchCalendar(month)) : null,
    wants(["forecast", "upcoming"]) ? safe(fetchFlow({ month, months: 2 })) : null,
    wants(["subscriptions"]) ? safe(fetchSubscriptions()) : null,
    safe(fetchRadar()),
  ]);
  return answer(query, {
    today, transactions, categories: categories ?? [], accounts: accounts ?? [],
    budget, cycle, calendar, flow, subscriptions: subscriptions?.items ?? [], radar: radar?.items ?? [],
  });
}
