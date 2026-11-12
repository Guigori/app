/**
 * FINNOS IA talking about an analysis it already has: "Me explique a análise Estimativa de saldo",
 * "Me explique melhor: <resumo>" from an analysis page, and follow-ups like "e como melhoro isso?".
 * It reads the same numbers as the widget (catalog readers, or the analyst for the older widgets),
 * so the answer is about what the person is looking at — in every mode, without a paid model.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  fetchAccounts, fetchBalanceHistory, fetchBudget, fetchBudgetCycleProgress, fetchBudgetSuggestion, fetchCards,
  fetchCategories, fetchCurrentBudgetCycle, fetchDashboard, fetchFlow, fetchSubscriptions, fetchTransactions,
} from "@/lib/data";
import { addMonth, currentMonth, formatBRL, todayISO } from "@/lib/format";
import { monthRange } from "@/lib/insights/fixedBills";
import { READERS, type Ctx, type Need, type Reading } from "@/lib/insights/catalog";
import { INSIGHTS, detailPath, type InsightDef } from "@/lib/insights/registry";
import { norm } from "@/lib/finnQuestion";
import type { FinnMessage, FinnVisual } from "@/lib/aiConversations";
import { askFinnAnalyst } from "@/lib/askFinnAnalyst";

export interface FinnTalk {
  text: string;
  visual?: FinnVisual;
  followUps: string[];
  links: { label: string; to: string }[];
  steps?: string[];
  /** The analysis the conversation is about, so a follow-up keeps the subject. */
  topic: string;
}

const EXPLAIN = /\b(expli\w*|o que (e|significa|quer dizer|mostra)|como (funciona|e calculad\w*|calcul\w*)|entender|entend\w|detalh\w*|fale (mais )?sobre|conversar sobre|analise\b)/;
/** A follow-up that only makes sense about the subject already on the table. */
const FOLLOW_UP = /^(e |e\?|por que|porque|pq|como (melhoro|melhorar|resolvo|resolver|mudo|mudar|corrijo|faco|evito)|o que (eu )?(faco|posso fazer|devo fazer|fazer)|isso|explique melhor|explica melhor|me explica|mais detalhes|detalhe|o que significa|e agora|e ai|entao|ok e|e se)/;

/** Older widgets have no reader: the analyst answers the question each one is about. */
const LEGACY_QUESTION: Record<string, string> = {
  "gastar-hoje": "Quanto ainda posso gastar este mês?",
  habitos: "Quanto gastei este mês?",
  renda: "Quanto recebi este mês?",
  "seis-meses": "Evolução das despesas por mês",
  contas: "Qual é o meu saldo?",
  orcamento: "Como está meu orçamento?",
  metas: "Como estão minhas metas?",
  "previsao-saldo": "Vou fechar o mês no positivo?",
  "semana-que-vem": "Quais contas vencem nos próximos 7 dias?",
  "fatura-que-vem": "Quais contas vencem este mês?",
  "contas-fixas": "Quais contas vencem este mês?",
  faturas: "Quais contas vencem este mês?",
  parcelas: "Quais contas vencem este mês?",
  categorias: "Para onde foi meu dinheiro este mês?",
  radar: "O que o Radar está vendo?",
};

/** What to do next, by theme, when the numbers themselves do not point at an action. */
const THEME_ADVICE: Record<string, string[]> = {
  Orçamento: ["Olhe primeiro as categorias que passaram do limite: um teto por semana nelas costuma bastar para fechar o mês.", "Se um limite estoura todo mês, ele pode estar baixo demais: ajuste para a sua média real."],
  Renda: ["Guarde assim que a renda entrar (nem que seja 10%): o que sobra no fim do mês costuma ser menos do que o planejado.", "Se a estimativa aperta em algum dia, mova um pagamento para depois da próxima entrada."],
  Compromissos: ["Confira se o saldo cobre os vencimentos da semana e marque como pagas as contas já quitadas para a estimativa ficar certa.", "Contas que se repetem todo mês podem virar fixas ou débito automático, assim nada atrasa."],
  Cartões: ["Antes de uma compra parcelada, veja quanto das próximas faturas já está ocupado.", "Pagar a fatura inteira evita juros do rotativo, que estão entre os mais caros do mercado."],
  Gastos: ["Comece pelos três maiores grupos de gasto: 10% neles rende mais que cortar vários gastos pequenos.", "Compare com o mês passado para ver se é um aumento pontual ou um hábito novo."],
  Metas: ["Um valor fixo por mês, guardado logo que a renda entra, mantém a meta no ritmo.", "Se uma meta atrasou, aumente um pouco o valor mensal ou estenda o prazo em vez de desistir."],
  Patrimônio: ["Dinheiro que não vai ser usado no mês rende mais numa reserva do que parado na conta.", "Mantenha uma reserva de pelo menos três meses de gastos antes de investir com mais risco."],
  Alertas: ["Resolva primeiro o aviso de maior risco: é o que mais pode pesar no mês.", "Muitos avisos repetidos indicam que vale criar um limite ou uma regra no orçamento."],
};

const titleKey = (def: InsightDef) => norm(def.title);

/** The analysis named in the context of the page, in the question, or the one already being talked about. */
export function resolveTopic(text: string, context: Record<string, unknown> | null, history: FinnMessage[]): { def: InsightDef; followUp: boolean } | null {
  const q = norm(text);
  // Amounts ("e se eu gastar R$ 100?") are simulations: the analyst and the simulator answer those.
  if (!EXPLAIN.test(q) && /\d/.test(q)) return null;
  const fromContext = typeof context?.analise === "string" ? INSIGHTS.find((d) => titleKey(d) === norm(String(context.analise))) : undefined;
  if (fromContext) {
    if (EXPLAIN.test(q)) return { def: fromContext, followUp: false };
    // A ready question of the page, or a follow-up: about the page. Anything else goes to the analyst.
    const ready = fromContext.questions.some((x) => norm(x) === q);
    return ready || FOLLOW_UP.test(q) ? { def: fromContext, followUp: true } : null;
  }
  if (EXPLAIN.test(q)) {
    const named = [...INSIGHTS].filter((d) => titleKey(d).length >= 5 && q.includes(titleKey(d))).sort((a, b) => b.title.length - a.title.length)[0];
    if (named) return { def: named, followUp: false };
  }
  const last = [...history].reverse().find((m) => m.role === "assistant");
  const topic = last?.topic ? INSIGHTS.find((d) => d.id === last.topic) : undefined;
  if (topic && (FOLLOW_UP.test(q) || q.split(" ").length <= 4 && /\b(isso|ele|ela|essa|esse|melhorar|melhoro)\b/.test(q))) return { def: topic, followUp: true };
  return null;
}

const stale = 60_000;
/** The data a reader needs, through the same cache as the widgets. */
async function buildCtx(client: QueryClient, needs: Need[]): Promise<Ctx> {
  const set = new Set(needs);
  const today = todayISO(), month = currentMonth(), prevMonth = addMonth(month, -1);
  const range = monthRange(month), prevRange = monthRange(prevMonth);
  const get = <T,>(want: Need, queryKey: unknown[], queryFn: () => Promise<T>): Promise<T | null> =>
    set.has(want) ? client.fetchQuery({ queryKey, queryFn, staleTime: stale }).catch(() => null) : Promise.resolve(null);
  const [tx, prevTx, allTx, dashboard, prevDashboard, subs, flow, cards, accounts, prevHistory, history, budget, cycle, suggestion, categories] = await Promise.all([
    get("tx", ["transactions", "month", range.start, range.end], () => fetchTransactions({ start_date: range.start, end_date: range.end })),
    get("prevTx", ["transactions", "month", prevRange.start, prevRange.end], () => fetchTransactions({ start_date: prevRange.start, end_date: prevRange.end })),
    get("allTx", ["transactions", "analysis-all"], () => fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" })),
    get("dashboard", ["dashboard", month], () => fetchDashboard(month)),
    get("prevDashboard", ["dashboard", prevMonth], () => fetchDashboard(prevMonth)),
    get("subs", ["subscriptions"], fetchSubscriptions),
    get("flow", ["flow", "insights", month], () => fetchFlow({ month, months: 6 })),
    get("cards", ["cards"], fetchCards),
    get("accounts", ["accounts"], fetchAccounts),
    get("prevHistory", ["balance-history", prevMonth], () => fetchBalanceHistory(prevMonth)),
    get("history", ["balance-history", month], () => fetchBalanceHistory(month)),
    get("budget", ["budget", month], () => fetchBudget(month)),
    get("cycle", ["budget-cycle-current-progress"], async () => { const c = await fetchCurrentBudgetCycle(); if (!c) return null; try { return { cycle: c, progress: await fetchBudgetCycleProgress(c.id) }; } catch { return { cycle: c, progress: null }; } }),
    get("suggestion", ["budget-suggestion"], async () => { try { return await fetchBudgetSuggestion(); } catch { return null; } }),
    get("categories", ["categories"], fetchCategories),
  ]);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    today, month, prevMonth, money: formatBRL,
    tx: arr(tx), prevTx: arr(prevTx), allTx: arr(allTx), dashboard: dashboard ?? null, prevDashboard: prevDashboard ?? null, subs: subs ?? null,
    cards: arr(cards), accounts: arr(accounts), flow: flow ?? null, prevHistory: prevHistory ?? null, history: history ?? null,
    budget: budget ?? null, cycle: cycle ?? null, suggestion: suggestion ?? null, categories: arr(categories),
  } as Ctx;
}

const lowerFirst = (t: string) => t.charAt(0).toLocaleLowerCase("pt-BR") + t.slice(1);
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** Over a limit: by how much, and the purchases that took it there (from the month's own transactions). */
function overLimits(r: Reading, ctx: Ctx): string[] {
  if (r.chart?.type !== "bullets") return [];
  const over = r.chart.items.filter((i) => i.limit > 0 && i.value > i.limit).sort((a, b) => (b.value - b.limit) - (a.value - a.limit)).slice(0, 2);
  return over.map((i) => {
    const key = norm(i.label);
    const top = ctx.tx.filter((t) => t.type === "despesa" && !(t.invoice_payment || t.balance_adjustment) && norm(t.category_name ?? "") === key).sort((a, b) => (b.adjusted_value ?? b.value) - (a.adjusted_value ?? a.value)).slice(0, 3);
    const list = top.map((t) => `${t.name} (${ctx.money(t.adjusted_value ?? t.value)}, ${t.date.slice(8, 10)}/${t.date.slice(5, 7)})`).join(", ");
    return `${i.label} passou **${ctx.money(i.value - i.limit)}** do limite (${ctx.money(i.value)} de ${ctx.money(i.limit)})${list ? `. O que mais pesou: ${list}` : ""}`;
  });
}

function fromReading(def: InsightDef, r: Reading, followUp: boolean, question: string, ctx: Ctx): Omit<FinnTalk, "topic" | "links" | "followUps"> {
  if (r.empty) return { text: `Na análise **${def.title}** ainda não há números para explicar: ${lowerFirst(sentence(r.empty))}\n\n**Como eu calculo:** ${def.how}` };
  const bad = r.findings.filter((f) => f.tone === "bad").map((f) => f.text);
  const good = r.findings.filter((f) => f.tone === "good").map((f) => f.text);
  const info = r.findings.filter((f) => f.tone === "info").map((f) => f.text);
  const over = overLimits(r, ctx);
  const actions = over.length ? [] : [...bad, ...info].slice(0, 3);
  const advice = [...actions, ...(actions.length >= 2 ? [] : (THEME_ADVICE[def.theme] ?? []).slice(0, 2))];
  const visual: FinnVisual = {
    title: def.title,
    metrics: [{ label: r.tile, value: r.value, tone: r.tone === "expense" ? "negative" : r.tone === "income" ? "positive" : "neutral" }],
    finnos: r.chart,
    items: r.rows?.length ? r.rows.slice(0, 6).map((row) => ({ label: row.label, value: row.value, detail: row.sub })) : undefined,
  };
  const wantsWhy = /\b(por que|porque|pq|motivo|causa)\b/.test(norm(question));
  if (followUp) {
    // Same subject, new angle: what to do (or why), not the whole explanation again.
    const reasons = over.length ? over : [...bad, ...info].slice(0, 2);
    const why = (wantsWhy || over.length) && reasons.length ? `${wantsWhy ? "O motivo, pelos seus números" : "Pelos seus números"}:\n${reasons.map((x) => `• ${sentence(x)}`).join("\n")}\n\n` : "";
    const rest = wantsWhy ? (THEME_ADVICE[def.theme] ?? advice) : advice;
    return { text: `${why}**O que eu faria em ${def.title}:**\n${rest.map((a) => `• ${sentence(a)}`).join("\n")}${good.length ? `\n\nO que já está bom: ${sentence(good[0])}` : ""}`, visual };
  }
  const parts = [
    `**${def.title}** — ${lowerFirst(sentence(def.description))}`,
    `Nos seus números: **${r.value}** (${r.note}). ${r.summary.map(sentence).join(" ")}`.trim(),
  ];
  if (over.length) parts.push(`**Onde passou:**\n${over.map((x) => `• ${sentence(x)}`).join("\n")}`);
  if (good.length) parts.push(`O que está indo bem: ${sentence(good[0])}`);
  if (advice.length) parts.push(`**O que eu faria:**\n${advice.map((a) => `• ${sentence(a)}`).join("\n")}`);
  parts.push(`**Como eu calculo:** ${def.how}`);
  return { text: parts.join("\n\n"), visual };
}

/** Answers about an analysis, or null when the message is not about one. */
export async function askFinnConverse(text: string, context: Record<string, unknown> | null, history: FinnMessage[], client: QueryClient, aliases: Record<string, string> = {}): Promise<FinnTalk | null> {
  const found = resolveTopic(text, context, history);
  if (!found) return null;
  const { def, followUp } = found;
  const links = [{ label: "Abrir a análise", to: detailPath(def.id) }];
  const followUps = def.questions.slice(0, 3);
  const reader = READERS[def.id];
  if (reader) {
    let r: Reading;
    let ctx: Ctx;
    try { ctx = await buildCtx(client, [...new Set<Need>([...reader.needs, "tx"])]); r = reader.read(ctx); } catch { return null; }
    const body = fromReading(def, r, followUp, text, ctx);
    return { ...body, followUps: followUp ? [...followUps.slice(0, 2), `Me explique a análise ${def.title}`] : [...followUps, "Como melhoro isso?"], links, topic: def.id, steps: [`Li a análise ${def.title} com os seus números`] };
  }
  const legacy = LEGACY_QUESTION[def.id];
  const analyst = legacy ? await askFinnAnalyst(legacy, [], aliases).catch(() => null) : null;
  const advice = (THEME_ADVICE[def.theme] ?? []).slice(0, 2);
  if (followUp) {
    return {
      text: `${analyst ? `${analyst.text}\n\n` : ""}**O que eu faria em ${def.title}:**\n${advice.map((a) => `• ${a}`).join("\n")}`,
      visual: analyst?.visual, followUps: [...followUps.slice(0, 2), `Me explique a análise ${def.title}`], links, topic: def.id,
    };
  }
  const parts = [`**${def.title}** — ${lowerFirst(sentence(def.description))}`];
  if (analyst) parts.push(`Nos seus números: ${analyst.text}`);
  if (analyst?.insight) parts.push(`Também notei: ${analyst.insight}`);
  if (advice.length) parts.push(`**O que eu faria:**\n${advice.map((a) => `• ${a}`).join("\n")}`);
  parts.push(`**Como eu calculo:** ${def.how}`);
  return { text: parts.join("\n\n"), visual: analyst?.visual, followUps: [...followUps, "Como melhoro isso?"], links: [...links, ...(analyst?.links ?? []).slice(0, 1)], topic: def.id, steps: [`Li a análise ${def.title} com os seus números`] };
}
