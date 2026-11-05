/** Gathers the user's data (local or online, through lib/data) and lets the analyst answer. */
import {
  fetchAccounts, fetchBudget, fetchBudgetCycleProgress, fetchCalendar, fetchCards, fetchCategories,
  fetchCurrentBudgetCycle, fetchFlow, fetchMe, fetchRadar, fetchSubscriptions, fetchTransactions,
} from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, todayISO } from "@/lib/format";
import { norm, parseQuestion, type FinnQuery } from "@/lib/finnQuestion";
import { answer, type FinnAnswer } from "@/lib/finnAnalyst";
import type { FinnMessage } from "@/lib/aiConversations";
import { proposalFor, type Proposal } from "@/lib/finnActions";

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
  const [categories, accounts, cards, recent, me] = await Promise.all([
    safe(fetchCategories()), safe(fetchAccounts()), safe(fetchCards()),
    safe(fetchTransactions({ start_date: recentStart, end_date: `${month}-31` })),
    safe(fetchMe()),
  ]);
  const goals = me ? await safe(listGoals(me.id)) ?? [] : [];
  const previous = [...history].reverse().find((m) => m.role === "assistant" && m.query)?.query ?? null;
  const query: FinnQuery = parseQuestion(text, {
    today,
    categories: categories ?? [],
    accounts: accounts ?? [],
    cards: cards ?? [],
    names: [...new Set((recent ?? []).map((tx) => norm(tx.name)))],
    aliases,
    goals: goals.map((g) => ({ id: g.id, name: g.name })),
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
  const [budget, cycle, calendar, flow, nextFlow, subscriptions, radar] = await Promise.all([
    wants(["budget"]) ? safe(fetchBudget(month)) : null,
    cycleMeta?.id ? safe(fetchBudgetCycleProgress(cycleMeta.id)) : null,
    wants(["forecast"]) ? safe(fetchCalendar(month)) : null,
    wants(["forecast", "upcoming", "runway"]) ? safe(fetchFlow({ month, months: 2 })) : null,
    wants(["runway"]) ? safe(fetchFlow({ month: addMonth(month, 1), months: 2 })) : null,
    wants(["subscriptions"]) ? safe(fetchSubscriptions()) : null,
    safe(fetchRadar()),
  ]);
  return answer(query, {
    today, transactions, categories: categories ?? [], accounts: accounts ?? [],
    goals, budget, cycle, calendar, flow, nextFlow, subscriptions: subscriptions?.items ?? [], radar: radar?.items ?? [],
  });
}

export interface FinnProposalReply {
  text: string;
  steps: string[];
  proposal?: Proposal;
  followUps?: string[];
}

/**
 * A message that asks to change something ("café 3,80 e táxi 14 hoje", "mova a Padaria para
 * Alimentação", "encontre assinaturas"): a proposal to review, or null when it asks nothing of the sort.
 */
export async function askFinnProposal(text: string, aliases: Record<string, string> = {}): Promise<FinnProposalReply | null> {
  const today = todayISO();
  const month = today.slice(0, 7);
  const [categories, accounts, transactions, subscriptions] = await Promise.all([
    safe(fetchCategories()), safe(fetchAccounts()),
    safe(fetchTransactions({ start_date: `${addMonth(month, -11)}-01`, end_date: `${month}-31` })),
    safe(fetchSubscriptions()),
  ]);
  const found = proposalFor(text, {
    today, accounts: accounts ?? [], categories: categories ?? [], transactions: transactions ?? [],
    subscriptions: subscriptions?.items ?? [], aliases,
  });
  if (!found) return null;
  if ("error" in found) return { text: found.error, steps: [] };
  if (found.kind === "register") {
    const n = found.entries.length;
    return {
      text: `Preparei ${n === 1 ? "1 lançamento" : `${n} lançamentos`}. Confira, corrija o que precisar e registre.${found.unknown.length ? ` Não usei: "${found.unknown.join("\", \"")}".` : ""}`,
      steps: ["Preparando os lançamentos"], proposal: found,
    };
  }
  if (found.kind === "recategorize") {
    if (!found.ids.length) return { text: `Não encontrei lançamentos de "${found.term}" fora de ${found.toName}.`, steps: ["Procurando os lançamentos"] };
    return {
      text: `Encontrei ${found.ids.length === 1 ? "1 lançamento" : `${found.ids.length} lançamentos`} de "${found.term}" que podem ir para ${found.toName}.`,
      steps: [`Lançamentos encontrados: ${found.ids.length}`], proposal: found,
    };
  }
  if (!found.candidates.length) return { text: "Não encontrei pagamentos que se repetem todo mês fora das suas assinaturas.", steps: ["Procurando repetições no último ano"], followUps: ["Quais assinaturas eu pago?"] };
  return {
    text: `Encontrei ${found.candidates.length === 1 ? "1 pagamento que chega" : `${found.candidates.length} pagamentos que chegam`} todo mês e ainda não ${found.candidates.length === 1 ? "está" : "estão"} nas suas assinaturas:`,
    steps: ["Procurando repetições no último ano"], proposal: found,
  };
}
