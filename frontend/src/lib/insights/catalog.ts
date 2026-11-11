/**
 * Biblioteca de análises · catálogo: twenty analyses written as plain readings of the data. Each one says what it
 * needs, and turns that data into a reading (main number, comparison, chart, rows, findings and the FINNOS IA
 * summary). One component (CatalogInsight) draws every reading in the P/M/G sizes and on the analysis page, always
 * with the Gráficos FINNOS.
 */
import type { CategorySlice, CreditCard, Account, Dashboard, Flow, Subscriptions, Transaction, BalanceHistory, BudgetSummary, BudgetCycle, BudgetCycleProgress, BudgetSuggestion, Category } from "@/types/finnos";
import { MORE_READERS } from "@/lib/insights/catalog2";
import type { Finding } from "@/lib/insights/invoices";
import type { Comparison } from "@/lib/insights/compare";
import { compare, shortMonthName } from "@/lib/insights/compare";
import { addMonth } from "@/lib/format";
import { categoryChanges, commitments } from "@/lib/analysisInsights";
import { fluxoSubscriptions } from "@/lib/subscriptionsView";
import { installmentPlans } from "@/lib/insights/installments";
import { lastMonths } from "@/lib/insights/habits";

export type Need = "tx" | "prevTx" | "allTx" | "dashboard" | "prevDashboard" | "subs" | "cards" | "accounts" | "flow" | "prevHistory" | "history" | "budget" | "cycle" | "suggestion" | "categories";

export interface Ctx {
  today: string;
  month: string;
  prevMonth: string;
  money: (v: number) => string;
  tx: Transaction[];
  prevTx: Transaction[];
  allTx: Transaction[];
  dashboard: Dashboard | null;
  prevDashboard: Dashboard | null;
  subs: Subscriptions | null;
  cards: CreditCard[];
  accounts: Account[];
  flow: Flow | null;
  prevHistory: BalanceHistory | null;
  history: BalanceHistory | null;
  budget: BudgetSummary | null;
  cycle: { cycle: BudgetCycle; progress: BudgetCycleProgress | null } | null;
  suggestion: BudgetSuggestion | null;
  categories: Category[];
}

export interface BarItem { label: string; value: number; focus?: boolean; future?: boolean; valueLabel?: string }
export interface SegItem { value: number; color: string; label: string; striped?: boolean }
export type Chart =
  | { type: "bars"; data: BarItem[] }
  | { type: "segmented"; segments: SegItem[]; total?: number }
  | { type: "gauge"; percent: number; center: string; detail: string; goal?: boolean }
  | { type: "donut"; slices: Array<{ id: string; name: string; value: number; color: string }>; center: string }
  | { type: "line"; points: Array<{ value: number; kind: "real" | "previsto"; label?: string }> }
  | { type: "bullets"; items: Array<{ label: string; value: number; limit: number; note?: string }> };

export interface Row { label: string; sub?: string; value: string; tone?: "income" | "expense"; color?: string }

export interface Reading {
  /** Nothing to show yet: the sentence that explains why (and the analysis still renders). */
  empty?: string;
  /** Title of the small tile (P). */
  tile: string;
  value: string;
  tone?: "income" | "expense";
  note: string;
  subtitle?: string;
  vs?: { c: Comparison | null; label: string; format: "money" | "count" | "points" };
  chart?: Chart;
  rows?: Row[];
  findings: Finding[];
  summary: string[];
  context: Record<string, unknown>;
}

// ---------- helpers ----------
const COLORS = ["var(--finnos-purple)", "var(--finnos-violet)", "var(--finnos-lilac)", "#0EA5E9", "#14B8A6", "#F59E0B", "#EC4899", "var(--finnos-app)"];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
const amount = (t: Transaction) => t.adjusted_value ?? t.value;
/** Real spending of a list: expenses that are not an invoice payment (the purchases already count). */
export const spending = (txs: Transaction[]) => txs.filter((t) => t.type === "despesa" && !t.invoice_payment && !t.invoice_refund);
const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + amount(t), 0);
const merchant = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\d+\/\d+$/, "");
const short = (m: string) => cap(shortMonthName(m));
const groupBy = <T,>(list: T[], key: (t: T) => string) => { const m = new Map<string, T[]>(); list.forEach((t) => { const k = key(t); m.set(k, [...(m.get(k) ?? []), t]); }); return m; };

// ---------- the twenty readings ----------
export const READERS: Record<string, { needs: Need[]; read: (c: Ctx) => Reading }> = {
  /** Assinaturas: what the recurring services cost a month (registered here and the ones Fluxo shows being charged). */
  assinaturas: {
    needs: ["subs", "allTx"],
    read: ({ subs, allTx, money, today }) => {
      const registered = (subs?.items ?? []).filter((s) => s.active);
      // Same rule as the Assinaturas screen: what is registered plus what Fluxo already charges every month.
      const fluxo = fluxoSubscriptions(allTx, subs?.items ?? [], today).onlyInFluxo;
      const items = [
        ...registered.map((s) => ({ name: s.name, monthly: s.recurrence === "anual" ? s.value / 12 : s.value, value: s.value, recurrence: s.recurrence, next: s.next_charge })),
        ...fluxo.map((f) => ({ name: f.name, monthly: f.value, value: f.value, recurrence: "mensal" as const, next: f.nextCharge })),
      ];
      const total = items.reduce((a, s) => a + s.monthly, 0);
      const sorted = [...items].sort((a, b) => b.monthly - a.monthly);
      const income = allTx.filter((t) => t.type === "receita" && t.status === "pago" && t.date.slice(0, 7) === today.slice(0, 7)).reduce((a, t) => a + t.value, 0);
      const share = income > 0 ? total / income : 0;
      const soon = items.filter((s) => s.next >= today && daysBetween(today, s.next) <= 7).sort((a, b) => a.next.localeCompare(b.next));
      const findings: Finding[] = [];
      if (soon.length) findings.push({ tone: "info", text: `${plural(soon.length, "cobrança", "cobranças")} nos próximos 7 dias: ${soon.map((s) => `${s.name} ${ddmm(s.next)}`).slice(0, 3).join(", ")}.` });
      if (total > 0) findings.push({ tone: "info", text: `Em um ano as assinaturas somam ${money(total * 12)}.` });
      if (share > 0.1) findings.push({ tone: "bad", text: `Levam ${pct(share)} da renda do mês: vale revisar as que você menos usa.` });
      return {
        empty: items.length ? undefined : "Nenhuma assinatura cadastrada nem cobrada no Fluxo (categoria Assinaturas).",
        tile: "Assinaturas", value: money(total), note: `por mês · ${plural(items.length, "ativa", "ativas")}`,
        chart: sorted.length ? { type: "segmented", total, segments: sorted.slice(0, 6).map((s, i) => ({ value: s.monthly, color: COLORS[i % COLORS.length], label: s.name })) } : undefined,
        rows: sorted.map((s) => ({ label: s.name, sub: `${s.recurrence === "anual" ? "anual" : "mensal"} · próxima ${ddmm(s.next)}`, value: money(s.value) })),
        findings,
        summary: [`Você tem ${plural(items.length, "assinatura ativa", "assinaturas ativas")} que custam ${money(total)} por mês.`, sorted[0] ? `A mais cara é ${sorted[0].name}: ${money(sorted[0].monthly)} por mês.` : "", findings[0]?.text ?? ""].filter(Boolean),
        context: { total_mensal: total, assinaturas: items.map((s) => ({ nome: s.name, valor: s.value, recorrencia: s.recurrence, proxima: s.next })) },
      };
    },
  },

  /** Compromissos: what the next six months already owe (fixed bills, subscriptions and installments). */
  compromissos: {
    needs: ["allTx", "subs", "dashboard"],
    read: ({ allTx, subs, dashboard, month, money }) => {
      const c = commitments(allTx, subs?.items ?? [], month, 6);
      const income = dashboard?.prev_income || dashboard?.income || 0;
      const now = c.months[0];
      const six = c.months.reduce((s, m) => s + m.total, 0);
      const last = c.months.at(-1);
      const findings: Finding[] = [];
      if (income > 0 && now) findings.push({ tone: now.total / income > 0.6 ? "bad" : "info", text: `Antes de qualquer gasto novo, ${pct(now.total / income)} da renda do mês já tem destino (fixos e parcelas).` });
      if (now && last && last.installments < now.installments) findings.push({ tone: "good", text: `As parcelas diminuem até ${shortMonthName(last.month)}, liberando ${money(now.installments - last.installments)} por mês.` });
      return {
        empty: c.months.some((m) => m.total > 0) ? undefined : "Nenhuma conta fixa, assinatura ou parcela pela frente.",
        tile: "Já comprometido", value: money(now?.total ?? 0), note: `neste mês · ${money(six)} em 6 meses`,
        subtitle: "Fixos, assinaturas e parcelas dos próximos meses",
        chart: { type: "bars", data: c.months.map((m, i) => ({ label: short(m.month), value: m.total, focus: i === 0, future: i > 0, valueLabel: money(m.total).replace(/,\d\d$/, "") })) },
        rows: [
          ...c.months.map((m) => ({ label: cap(shortMonthName(m.month)) + " " + m.month.slice(2, 4), sub: `fixos ${money(m.fixed)} · parcelas ${money(m.installments)}`, value: money(m.total) })),
          ...c.fixedItems.slice(0, 10).map((f) => ({ label: f.name, sub: f.kind === "assinatura" ? "Assinatura" : "Conta fixa", value: `${money(f.value)}/mês` })),
          ...c.installmentItems.slice(0, 10).map((p) => ({ label: p.name, sub: `parcela · faltam ${money(p.remaining)}`, value: `${money(p.value)}/mês` })),
        ],
        findings,
        summary: [`Neste mês ${money(now?.total ?? 0)} já estavam comprometidos: ${money(now?.fixed ?? 0)} em contas fixas e assinaturas e ${money(now?.installments ?? 0)} em parcelas.`, `Nos próximos 6 meses são ${money(six)}.`, findings[1]?.text ?? findings[0]?.text ?? ""].filter(Boolean),
        context: { meses: c.months, fixos: c.fixedItems, parcelas: c.installmentItems },
      };
    },
  },

  /** Maiores gastos do mês: the five biggest purchases and how much of the month they make. */
  "maiores-gastos": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const list = spending(tx).sort((a, b) => amount(b) - amount(a));
      const top = list.slice(0, 5);
      const total = sum(list), topSum = sum(top);
      const prevTop = spending(prevTx).sort((a, b) => amount(b) - amount(a))[0];
      return {
        empty: list.length ? undefined : "Nenhuma despesa no mês ainda.",
        tile: "Maior gasto", value: top[0] ? money(amount(top[0])) : money(0), note: top[0] ? top[0].name : "nenhum gasto",
        subtitle: "Os cinco maiores do mês",
        vs: { c: compare(top[0] ? amount(top[0]) : 0, prevTop ? amount(prevTop) : null, "lower"), label: "vs maior do mês passado", format: "money" },
        chart: { type: "bars", data: top.map((t, i) => ({ label: t.name.slice(0, 8), value: amount(t), focus: i === 0, valueLabel: money(amount(t)).replace(/,\d\d$/, "") })) },
        rows: (list.length > 5 ? list.slice(0, 10) : top).map((t) => ({ label: t.name, sub: `${ddmm(t.date)} · ${t.category_name ?? "Sem categoria"}`, value: money(amount(t)), color: t.category_color ?? undefined })),
        findings: total > 0 ? [{ tone: topSum / total > 0.5 ? "bad" : "info", text: `Os ${top.length} maiores somam ${money(topSum)}, ${pct(topSum / total)} de tudo que saiu no mês.` }] : [],
        summary: top[0] ? [`O maior gasto do mês foi ${top[0].name}: ${money(amount(top[0]))} em ${ddmm(top[0].date)}.`, total > 0 ? `Os ${top.length} maiores somam ${money(topSum)}, ${pct(topSum / total)} do mês.` : ""].filter(Boolean) : ["Ainda não há gastos no mês."],
        context: { maiores: top.map((t) => ({ nome: t.name, valor: amount(t), data: t.date, categoria: t.category_name })) },
      };
    },
  },

  /** Quanto você guardou: the share of the income left after the month's spending, against the months before. */
  "taxa-poupanca": {
    needs: ["flow"],
    read: ({ flow, month, money }) => {
      const r = lastMonths(flow?.series ?? [], month);
      const rate = (p: { income: number; net: number }) => (p.income > 0 ? p.net / p.income : 0);
      const cur = r.current;
      const closed = r.months.filter((p) => p.month < month && p.income > 0);
      const avg = closed.length ? closed.reduce((s, p) => s + rate(p), 0) / closed.length : null;
      const prev = r.months.find((p) => p.month === addMonth(month, -1));
      const now = cur ? rate(cur) : 0;
      return {
        empty: cur && cur.income > 0 ? undefined : "Sem renda registrada neste mês para calcular quanto sobra.",
        tile: "Guardou do que entrou", value: pct(now), tone: now < 0 ? "expense" : "income", note: cur ? `${money(cur.net)} de ${money(cur.income)}` : "",
        vs: { c: compare(now * 100, prev && prev.income > 0 ? rate(prev) * 100 : null, "higher"), label: `vs ${short(addMonth(month, -1)).toLowerCase()}`, format: "points" },
        chart: { type: "gauge", goal: true, percent: Math.max(0, now) / 0.2, center: pct(now), detail: `meta 20% · ${money(cur?.net ?? 0)}` },
        rows: [...r.months].reverse().map((p) => ({ label: cap(shortMonthName(p.month)), sub: `${money(p.income)} entrou`, value: p.income > 0 ? pct(rate(p)) : "—", tone: p.net < 0 ? "expense" : undefined })),
        findings: [
          { tone: now >= 0.2 ? "good" : now >= 0.1 ? "info" : "bad", text: now >= 0.2 ? "Acima dos 20% que costumam ser a meta para guardar." : now >= 0 ? `Para chegar a 20% faltam ${money(Math.max(0, 0.2 * (cur?.income ?? 0) - (cur?.net ?? 0)))} neste mês.` : "Neste mês está saindo mais do que entra." },
          ...(avg != null ? [{ tone: "info" as const, text: `A média dos últimos meses foi ${pct(avg)}.` }] : []),
        ],
        summary: [cur ? `Neste mês sobraram ${money(cur.net)} dos ${money(cur.income)} que entraram: ${pct(now)}.` : "", avg != null ? `Nos meses anteriores a média foi ${pct(avg)}.` : "", now >= 0.2 ? "Você está acima dos 20% de referência." : "A referência costuma ser guardar 20% do que entra."].filter(Boolean),
        context: { taxa: now, media: avg, meses: r.months.map((p) => ({ mes: p.month, entrada: p.income, resultado: p.net })) },
      };
    },
  },

  /** Regra 50/30/20: necessidades, desejos e metas against the share of the income each should take. */
  "regra-50-30-20": {
    needs: ["dashboard", "prevDashboard"],
    read: ({ dashboard, prevDashboard, money }) => {
      const rule = dashboard?.rule ?? [];
      const over = rule.filter((r) => r.status === "acima");
      const color: Record<string, string> = { necessidades: "var(--finnos-purple)", desejos: "var(--finnos-violet)", metas: "var(--income)" };
      const desejos = rule.find((r) => r.key === "desejos"), prevDesejos = prevDashboard?.rule.find((r) => r.key === "desejos");
      return {
        empty: rule.length && (dashboard?.income ?? 0) > 0 ? undefined : "A regra precisa da renda do mês para dividir em 50%, 30% e 20%.",
        tile: "Regra 50/30/20", value: over.length ? `${over.length} acima` : "No limite", tone: over.length ? "expense" : "income", note: over.length ? over.map((r) => r.label).join(", ") : "todas as partes dentro",
        vs: { c: compare(desejos?.spent ?? 0, prevDesejos?.spent ?? null, "lower"), label: "desejos vs mês passado", format: "money" },
        chart: { type: "bullets", items: rule.map((r) => ({ label: r.label, value: r.spent, limit: r.limit, note: `${Math.round(r.percent)}% do limite` })) },
        rows: rule.map((r) => ({ label: r.label, sub: `limite ${money(r.limit)}`, value: money(r.spent), tone: r.status === "acima" ? "expense" : undefined, color: color[r.key] })),
        findings: rule.map((r) => ({ tone: r.status === "acima" ? "bad" : r.status === "proximo" ? "info" : "good", text: `${r.label}: ${money(r.spent)} de ${money(r.limit)} (${Math.round(r.percent)}%).` })),
        summary: [over.length ? `${over.map((r) => r.label).join(" e ")} ${over.length === 1 ? "passou" : "passaram"} da parte da renda que caberia.` : "Necessidades, desejos e metas estão dentro da divisão 50/30/20.", ...rule.slice(0, 2).map((r) => `${r.label}: ${money(r.spent)} de ${money(r.limit)}.`)],
        context: { regra: rule.map((r) => ({ parte: r.label, gasto: r.spent, limite: r.limit, status: r.status })) },
      };
    },
  },

  /** Categorias que mais subiram: what grew from last month to this one. */
  "categorias-subiram": {
    needs: ["dashboard", "prevDashboard"],
    read: ({ dashboard, prevDashboard, money }) => {
      const changes = categoryChanges(dashboard?.categories ?? [], prevDashboard?.categories ?? []);
      const up = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta);
      const down = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta);
      return {
        empty: changes.length ? undefined : "Ainda não há gastos para comparar com o mês passado.",
        tile: "Mais subiu", value: up[0] ? up[0].name : "Nada subiu", tone: up[0] ? "expense" : "income", note: up[0] ? `+${money(up[0].delta)} vs mês passado` : "todas iguais ou menores",
        vs: { c: compare(dashboard?.expense ?? 0, prevDashboard?.expense ?? null, "lower"), label: "total vs mês passado", format: "money" },
        // Categories that existed last month: the bar against last month's mark. Only new ones: bars of how much each grew.
        chart: up.some((c) => c.previous > 0)
          ? { type: "bullets", items: up.filter((c) => c.previous > 0).slice(0, 4).map((c) => ({ label: c.name, value: c.current, limit: c.previous, note: c.deltaPct == null ? "nova" : `+${Math.round(c.deltaPct)}%` })) }
          : up.length ? { type: "bars", data: up.slice(0, 5).map((c, i) => ({ label: c.name.slice(0, 8), value: c.delta, focus: i === 0, valueLabel: `+${money(c.delta).replace(/,\d\d$/, "")}` })) } : undefined,
        rows: [...up, ...down].map((c) => ({ label: c.name, sub: `${money(c.previous)} → ${money(c.current)}`, value: `${c.delta > 0 ? "+" : "−"}${money(Math.abs(c.delta))}`, tone: c.delta > 0 ? "expense" : "income", color: c.color })),
        findings: [
          ...(up[0] ? [{ tone: "bad" as const, text: `${up[0].name} subiu ${money(up[0].delta)}${up[0].deltaPct != null ? ` (+${Math.round(up[0].deltaPct)}%)` : ", nova neste mês"}.` }] : []),
          ...(down[0] ? [{ tone: "good" as const, text: `${down[0].name} caiu ${money(-down[0].delta)}.` }] : []),
        ],
        summary: [up[0] ? `${up[0].name} foi o que mais subiu: de ${money(up[0].previous)} para ${money(up[0].current)}.` : "Nenhuma categoria subiu em relação ao mês passado.", down[0] ? `${down[0].name} foi a que mais caiu: ${money(-down[0].delta)} a menos.` : "", `${plural(up.length, "categoria subiu", "categorias subiram")} e ${plural(down.length, "caiu", "caíram")}.`].filter(Boolean),
        context: { mudancas: changes.map((c) => ({ categoria: c.name, antes: c.previous, agora: c.current })) },
      };
    },
  },

  /** Limite dos cartões: how much of each card's limit is taken (with installments to come). */
  "limite-cartoes": {
    needs: ["cards"],
    read: ({ cards, money }) => {
      const list = cards.filter((c) => c.active && c.limit > 0).sort((a, b) => b.used_percent - a.used_percent);
      const limit = list.reduce((s, c) => s + c.limit, 0), used = list.reduce((s, c) => s + c.used, 0);
      const high = list.filter((c) => c.used / c.limit >= 0.8);
      return {
        empty: list.length ? undefined : "Nenhum cartão com limite cadastrado.",
        tile: "Limite usado", value: pct(limit ? used / limit : 0), tone: used / Math.max(limit, 1) >= 0.8 ? "expense" : undefined, note: `${money(Math.max(0, limit - used))} livres`,
        chart: { type: "gauge", percent: limit ? used / limit : 0, center: pct(limit ? used / limit : 0), detail: `${money(used)} de ${money(limit)}` },
        rows: list.map((c) => ({ label: c.name, sub: `${money(c.available)} livres · melhor dia ${ddmm(c.best_purchase_day)}`, value: `${money(c.used)} / ${money(c.limit)}`, tone: c.used / c.limit >= 0.8 ? "expense" : undefined, color: c.color })),
        findings: [
          ...(high.length ? [{ tone: "bad" as const, text: `${high.map((c) => c.name).join(", ")} ${high.length === 1 ? "está" : "estão"} com mais de 80% do limite usado.` }] : [{ tone: "good" as const, text: "Nenhum cartão perto do limite." }]),
          ...(list[0] ? [{ tone: "info" as const, text: `Melhor dia para comprar no ${list[0].name}: ${ddmm(list[0].best_purchase_day)}.` }] : []),
        ],
        summary: [`Dos ${money(limit)} de limite, ${money(used)} estão usados (${pct(limit ? used / limit : 0)}), contando as parcelas futuras.`, high.length ? `${high.map((c) => c.name).join(" e ")} ${high.length === 1 ? "está perto" : "estão perto"} do limite.` : "Nenhum cartão está perto do limite."],
        context: { cartoes: list.map((c) => ({ nome: c.name, usado: c.used, limite: c.limit, parcelas_futuras: c.future_installments })) },
      };
    },
  },

  /** Cartão ou conta: how the month's spending is paid, by card and by debit. */
  "cartao-x-conta": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const list = spending(tx);
      const total = sum(list);
      const byCard = groupBy(list.filter((t) => t.card_id), (t) => t.card_name ?? "Cartão");
      const debit = sum(list.filter((t) => !t.card_id));
      const share = (txs: Transaction[]) => { const all = sum(spending(txs)); return all ? sum(spending(txs).filter((t) => t.card_id)) / all : 0; };
      const slices = [...[...byCard.entries()].map(([name, ts], i) => ({ id: name, name, value: sum(ts), color: COLORS[i % COLORS.length] })), ...(debit > 0 ? [{ id: "debito", name: "Conta (débito/Pix)", value: debit, color: "var(--income)" }] : [])].sort((a, b) => b.value - a.value);
      const cardShare = share(tx);
      return {
        empty: total > 0 ? undefined : "Nenhuma despesa no mês ainda.",
        tile: "No cartão", value: pct(cardShare), note: `${money(total - debit)} de ${money(total)}`,
        vs: { c: compare(cardShare * 100, prevTx.length ? share(prevTx) * 100 : null, "lower"), label: "no cartão vs mês passado", format: "points" },
        chart: { type: "donut", slices, center: "Gasto no mês" },
        rows: slices.map((s) => ({ label: s.name, value: money(s.value), sub: pct(s.value / Math.max(total, 0.01)), color: s.color })),
        findings: [{ tone: cardShare > 0.7 ? "info" : "good", text: cardShare > 0.7 ? `${pct(cardShare)} do mês foi no cartão: chega tudo junto na fatura.` : `${pct(1 - cardShare)} do mês saiu direto da conta.` }],
        summary: [`Neste mês ${pct(cardShare)} dos gastos foram no cartão (${money(total - debit)}) e ${money(debit)} saíram direto da conta.`, slices[0] ? `${slices[0].name} concentra ${pct(slices[0].value / Math.max(total, 0.01))}.` : ""].filter(Boolean),
        context: { cartao: total - debit, conta: debit, por_meio: slices.map((s) => ({ meio: s.name, valor: s.value })) },
      };
    },
  },

  /** Gastos pequenos: the many small purchases that add up (efeito formiga). */
  "gastos-pequenos": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const LIMIT = 50;
      const small = (txs: Transaction[]) => spending(txs).filter((t) => amount(t) <= LIMIT && !t.fixed && !t.installment);
      const list = small(tx), total = sum(list), all = sum(spending(tx));
      const places = [...groupBy(list, (t) => merchant(t.name)).entries()].map(([, ts]) => ({ name: ts[0].name, count: ts.length, total: sum(ts) })).sort((a, b) => b.total - a.total);
      return {
        empty: list.length ? undefined : `Nenhum gasto de até ${money(LIMIT)} neste mês.`,
        tile: "Gastos pequenos", value: money(total), note: `${plural(list.length, "compra", "compras")} de até ${money(LIMIT)}`,
        vs: { c: compare(total, prevTx.length ? sum(small(prevTx)) : null, "lower"), label: "vs mês passado", format: "money" },
        chart: places.length ? { type: "bars", data: places.slice(0, 5).map((p, i) => ({ label: p.name.slice(0, 8), value: p.total, focus: i === 0, valueLabel: `${p.count}x` })) } : undefined,
        rows: places.map((p) => ({ label: p.name, sub: `${p.count}x no mês`, value: money(p.total) })),
        findings: [
          ...(all > 0 ? [{ tone: total / all > 0.15 ? "bad" as const : "info" as const, text: `As compras pequenas já são ${pct(total / all)} do mês.` }] : []),
          ...(places[0] && places[0].count >= 3 ? [{ tone: "info" as const, text: `${places[0].name}: ${places[0].count} vezes, ${money(places[0].total)} no mês.` }] : []),
        ],
        summary: [`Neste mês foram ${plural(list.length, "compra pequena", "compras pequenas")} (até ${money(LIMIT)}) que somam ${money(total)}.`, places[0] ? `A que mais se repete é ${places[0].name}: ${places[0].count} vezes.` : "", all > 0 ? `Juntas são ${pct(total / all)} do que saiu.` : ""].filter(Boolean),
        context: { total, quantidade: list.length, lugares: places.slice(0, 8) },
      };
    },
  },

  /** Reserva de emergência: how many months of spending the money in the accounts would cover. */
  reserva: {
    needs: ["accounts", "flow", "prevHistory"],
    read: ({ accounts, flow, month, money, prevHistory }) => {
      const balance = accounts.filter((a) => a.active).reduce((s, a) => s + Math.max(0, a.balance), 0);
      const avg = lastMonths(flow?.series ?? [], month).averageExpense;
      const months = avg > 0 ? balance / avg : 0;
      const target = 6;
      const prevMonths = avg > 0 && prevHistory ? Math.max(0, prevHistory.balance) / avg : null;
      const label = months.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      return {
        empty: avg > 0 ? undefined : "É preciso pelo menos um mês fechado com gastos para calcular a reserva.",
        tile: "Reserva", value: `${label} ${months >= 0.95 && months < 1.05 ? "mês" : "meses"}`, tone: months < 3 ? "expense" : "income", note: `de gastos cobertos · meta ${target}`,
        vs: { c: compare(Math.round(months * 10) / 10, prevMonths != null ? Math.round(prevMonths * 10) / 10 : null, "higher"), label: "meses vs mês passado", format: "count" },
        chart: { type: "gauge", goal: true, percent: months / target, center: `${label} m`, detail: `${money(balance)} de ${money(avg * target)}` },
        rows: [{ label: "Nas contas", value: money(balance) }, { label: "Gasto médio por mês", value: money(avg) }, { label: `Meta de ${target} meses`, value: money(avg * target) }, { label: "Falta para a meta", value: money(Math.max(0, avg * target - balance)), tone: balance < avg * target ? "expense" : "income" }],
        findings: [{ tone: months >= target ? "good" : months >= 3 ? "info" : "bad", text: months >= target ? `A reserva cobre mais de ${target} meses.` : `Para ${target} meses faltam ${money(avg * target - balance)}.` }],
        summary: [`Com ${money(balance)} nas contas e um gasto médio de ${money(avg)}, você cobre ${label} meses.`, months >= target ? "Já passou da meta de 6 meses de reserva." : `Para a meta de ${target} meses faltam ${money(avg * target - balance)}.`],
        context: { saldo: balance, gasto_medio: avg, meses: months },
      };
    },
  },

  /** Resultado do mês: what came in minus what went out, so far and with what is still expected. */
  "resultado-mes": {
    needs: ["flow"],
    read: ({ flow, month, money }) => {
      const f = flow;
      const income = f?.income ?? 0, expense = f?.expense ?? 0, net = income - expense;
      const toIn = (f?.upcoming ?? []).filter((u) => u.type === "receita").reduce((s, u) => s + u.value, 0);
      const toOut = (f?.upcoming ?? []).filter((u) => u.type === "despesa").reduce((s, u) => s + u.value, 0);
      const end = net + toIn - toOut;
      const prev = lastMonths(f?.series ?? [], month).months.find((p) => p.month === addMonth(month, -1));
      return {
        tile: "Resultado do mês", value: `${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`, tone: net < 0 ? "expense" : "income", note: `estimativa ${end >= 0 ? "+" : "−"}${money(Math.abs(end))}`,
        vs: { c: compare(end, prev?.net ?? null, "higher"), label: `estimativa vs ${short(addMonth(month, -1)).toLowerCase()}`, format: "money" },
        chart: { type: "bars", data: [{ label: "Entrou", value: income, valueLabel: money(income).replace(/,\d\d$/, "") }, { label: "Saiu", value: expense, focus: true, valueLabel: money(expense).replace(/,\d\d$/, "") }, { label: "Entra", value: toIn, future: true, valueLabel: money(toIn).replace(/,\d\d$/, "") }, { label: "Sai", value: toOut, future: true, valueLabel: money(toOut).replace(/,\d\d$/, "") }] },
        rows: [{ label: "Entrou", value: money(income), tone: "income" }, { label: "Saiu", value: money(expense), tone: "expense" }, { label: "Ainda entra", value: money(toIn), tone: "income" }, { label: "Ainda sai", value: money(toOut), tone: "expense" }, { label: "Estimativa do mês", value: `${end >= 0 ? "+" : "−"}${money(Math.abs(end))}`, tone: end < 0 ? "expense" : "income" }],
        findings: [{ tone: end >= 0 ? "good" : "bad", text: end >= 0 ? `O mês deve fechar com ${money(end)} sobrando.` : `O mês deve fechar ${money(-end)} no negativo.` }],
        summary: [`Até agora entraram ${money(income)} e saíram ${money(expense)}: ${net >= 0 ? "sobram" : "faltam"} ${money(Math.abs(net))}.`, `Com o que ainda entra (${money(toIn)}) e sai (${money(toOut)}), o mês fecha em ${end >= 0 ? "+" : "−"}${money(Math.abs(end))}.`, prev ? `${short(prev.month)} fechou em ${prev.net >= 0 ? "+" : "−"}${money(Math.abs(prev.net))}.` : ""].filter(Boolean),
        context: { entrou: income, saiu: expense, ainda_entra: toIn, ainda_sai: toOut, estimativa: end },
      };
    },
  },

  /** Saídas por conta e cartão: where the money of the month leaves from. */
  "saidas-por-conta": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const by = (txs: Transaction[]) => [...groupBy(spending(txs), (t) => t.card_name || t.account_name || "Conta").entries()].map(([name, ts]) => ({ name, total: sum(ts), count: ts.length })).sort((a, b) => b.total - a.total);
      const list = by(tx), prev = new Map(by(prevTx).map((p) => [p.name, p.total]));
      const total = list.reduce((s, p) => s + p.total, 0);
      return {
        empty: list.length ? undefined : "Nenhuma despesa no mês ainda.",
        tile: "Mais saiu de", value: list[0]?.name ?? "—", note: list[0] ? `${money(list[0].total)} · ${pct(list[0].total / Math.max(total, 0.01))}` : "",
        vs: { c: compare(list[0]?.total ?? 0, list[0] ? prev.get(list[0].name) ?? null : null, "lower"), label: "vs mês passado", format: "money" },
        chart: { type: "bars", data: list.slice(0, 6).map((p, i) => ({ label: p.name.slice(0, 8), value: p.total, focus: i === 0, valueLabel: money(p.total).replace(/,\d\d$/, "") })) },
        rows: list.map((p) => ({ label: p.name, sub: `${plural(p.count, "lançamento", "lançamentos")}${prev.has(p.name) ? ` · ${money(prev.get(p.name)!)} no mês passado` : ""}`, value: money(p.total) })),
        findings: list[0] ? [{ tone: "info", text: `${list[0].name} concentra ${pct(list[0].total / Math.max(total, 0.01))} das saídas do mês.` }] : [],
        summary: list[0] ? [`${list[0].name} é de onde mais saiu dinheiro neste mês: ${money(list[0].total)}.`, list[1] ? `Depois vem ${list[1].name}, com ${money(list[1].total)}.` : ""].filter(Boolean) : ["Ainda não há saídas no mês."],
        context: { por_conta: list },
      };
    },
  },

  /** Fixo x variável: how much of the month is already committed with fixed bills and how much is choice. */
  "fixo-x-variavel": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const split = (txs: Transaction[]) => { const l = spending(txs); const fixed = sum(l.filter((t) => t.fixed || t.recurrence)); const inst = sum(l.filter((t) => !t.fixed && !t.recurrence && t.installment)); return { fixed, inst, variable: sum(l) - fixed - inst, total: sum(l) }; };
      const s = split(tx), p = prevTx.length ? split(prevTx) : null;
      const share = s.total ? (s.fixed + s.inst) / s.total : 0;
      return {
        empty: s.total > 0 ? undefined : "Nenhuma despesa no mês ainda.",
        tile: "Já comprometido", value: pct(share), note: `fixas e parcelas · ${money(s.fixed + s.inst)}`,
        vs: { c: compare(s.variable, p?.variable ?? null, "lower"), label: "variável vs mês passado", format: "money" },
        chart: { type: "segmented", total: s.total, segments: [{ value: s.fixed, color: "var(--finnos-purple)", label: "Fixas" }, { value: s.inst, color: "var(--finnos-violet)", label: "Parcelas" }, { value: s.variable, color: "var(--finnos-lilac)", label: "Variável" }] },
        rows: [{ label: "Contas fixas", value: money(s.fixed), color: "var(--finnos-purple)" }, { label: "Parcelas", value: money(s.inst), color: "var(--finnos-violet)" }, { label: "Variável (o que você escolhe)", value: money(s.variable), color: "var(--finnos-lilac)" }],
        findings: [{ tone: share > 0.6 ? "bad" : "info", text: share > 0.6 ? `${pct(share)} do mês já vem comprometido: sobra pouco espaço para escolher.` : `${pct(1 - share)} do mês é variável: é aí que dá para ajustar.` }],
        summary: [`Neste mês ${money(s.fixed)} foram contas fixas, ${money(s.inst)} parcelas e ${money(s.variable)} gastos variáveis.`, `Ou seja, ${pct(share)} já vinha comprometido.`, p ? `O variável ${s.variable > p.variable ? "subiu" : "caiu"} ${money(Math.abs(s.variable - p.variable))} em relação ao mês passado.` : ""].filter(Boolean),
        context: s,
      };
    },
  },

  /** Gasto por semana: the month in weeks, this week against the same week of last month. */
  "semanas-do-mes": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money, today, month }) => {
      const week = (d: string) => Math.min(4, Math.floor((Number(d.slice(8, 10)) - 1) / 7));
      const LABELS = ["1–7", "8–14", "15–21", "22–28", "29+"];
      const totals = (txs: Transaction[]) => { const w = [0, 0, 0, 0, 0]; spending(txs).forEach((t) => { w[week(t.date)] += amount(t); }); return w; };
      const cur = totals(tx.filter((t) => t.date <= today)), prev = totals(prevTx);
      const now = today.slice(0, 7) === month ? week(today) : 4;
      return {
        tile: "Esta semana", value: money(cur[now]), note: `dias ${LABELS[now]}`,
        vs: { c: compare(cur[now], prevTx.length ? prev[now] : null, "lower"), label: "vs mesma semana do mês passado", format: "money" },
        chart: { type: "bars", data: cur.map((v, i) => ({ label: LABELS[i], value: i > now ? prev[i] : v, focus: i === now, future: i > now, valueLabel: i > now ? "" : money(v).replace(/,\d\d$/, "") })) },
        rows: cur.map((v, i) => ({ label: `Dias ${LABELS[i]}`, sub: `mês passado ${money(prev[i])}`, value: i > now ? "—" : money(v), tone: i <= now && v > prev[i] ? "expense" : undefined })),
        findings: [{ tone: cur[now] > prev[now] ? "bad" : "good", text: cur[now] > prev[now] ? `Esta semana já passa a mesma semana do mês passado em ${money(cur[now] - prev[now])}.` : `Esta semana está ${money(prev[now] - cur[now])} abaixo da mesma do mês passado.` }],
        summary: [`Na semana dos dias ${LABELS[now]} saíram ${money(cur[now])}.`, `Na mesma semana do mês passado foram ${money(prev[now])}.`, `A semana mais cara do mês até agora foi a dos dias ${LABELS[cur.slice(0, now + 1).indexOf(Math.max(...cur.slice(0, now + 1)))]}.`],
        context: { semanas: cur, mes_passado: prev },
      };
    },
  },

  /** Até a próxima renda: how many days until the next income and how much there is per day until then. */
  "ate-salario": {
    needs: ["flow", "accounts"],
    read: ({ flow, accounts, today, money }) => {
      const next = (flow?.upcoming ?? []).filter((u) => u.type === "receita" && u.date >= today).sort((a, b) => b.value - a.value || a.date.localeCompare(b.date))[0];
      const balance = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
      const days = next ? Math.max(1, daysBetween(today, next.date)) : 0;
      const out = next ? (flow?.upcoming ?? []).filter((u) => u.type === "despesa" && u.date <= next.date).reduce((s, u) => s + u.value, 0) : 0;
      const free = balance - out;
      const perDay = days ? free / days : 0;
      return {
        empty: next ? undefined : "Nenhuma receita prevista no mês. Agende a próxima entrada para ver quanto dá por dia até ela.",
        tile: "Até a próxima renda", value: next ? plural(days, "dia", "dias") : "—", note: next ? `${money(perDay)} por dia até ${ddmm(next.date)}` : "",
        tone: perDay < 0 ? "expense" : undefined,
        chart: next ? { type: "segmented", total: Math.max(balance, out, 0.01), segments: [{ value: Math.min(out, Math.max(balance, 0)), color: "var(--expense)", label: "Já comprometido" }, { value: Math.max(0, free), color: "var(--income)", label: "Livre até lá" }] } : undefined,
        rows: next ? [{ label: `${next.name} em ${ddmm(next.date)}`, value: money(next.value), tone: "income" }, { label: "Nas contas agora", value: money(balance) }, { label: "Ainda sai até lá", value: money(out), tone: "expense" }, { label: "Livre por dia", value: money(perDay), tone: perDay < 0 ? "expense" : "income" }] : [],
        findings: next ? [{ tone: free < 0 ? "bad" : "info", text: free < 0 ? `O que sai até ${ddmm(next.date)} passa o saldo em ${money(-free)}.` : `Dá ${money(perDay)} por dia até ${next.name}.` }] : [],
        summary: next ? [`Faltam ${plural(days, "dia", "dias")} para ${next.name} (${money(next.value)}) em ${ddmm(next.date)}.`, `Até lá ainda saem ${money(out)} do saldo de ${money(balance)}.`, free >= 0 ? `Sobram ${money(perDay)} por dia.` : `Falta ${money(-free)} para chegar até lá.`] : ["Não há nenhuma receita prevista para o resto do mês."],
        context: next ? { proxima: next, saldo: balance, sai_ate_la: out, por_dia: perDay } : {},
      };
    },
  },

  /** Em aberto: everything of the month not paid yet, and what is already late. */
  "em-aberto": {
    needs: ["tx"],
    read: ({ tx, today, money }) => {
      const open = spending(tx).filter((t) => t.status !== "pago" && !t.card_id).sort((a, b) => a.date.localeCompare(b.date));
      const late = open.filter((t) => t.date < today), soon = open.filter((t) => t.date >= today);
      return {
        empty: open.length ? undefined : "Nada em aberto neste mês. Tudo pago.",
        tile: late.length ? "Atrasado" : "Em aberto", value: money(late.length ? sum(late) : sum(open)), tone: late.length ? "expense" : undefined, note: late.length ? `${plural(late.length, "conta", "contas")} · ${money(sum(soon))} a vencer` : plural(open.length, "conta a pagar", "contas a pagar"),
        chart: { type: "segmented", total: sum(open), segments: [{ value: sum(late), color: "var(--expense)", label: "Atrasado" }, { value: sum(soon), color: "var(--finnos-purple)", striped: true, label: "A vencer" }] },
        rows: open.map((t) => ({ label: t.name, sub: `${t.date < today ? "venceu" : "vence"} ${ddmm(t.date)}`, value: money(amount(t)), tone: t.date < today ? "expense" : undefined })),
        findings: late.length ? [{ tone: "bad", text: `${plural(late.length, "conta atrasada", "contas atrasadas")}: ${late.slice(0, 3).map((t) => `${t.name} (${money(amount(t))}, venceu ${ddmm(t.date)})`).join(", ")}.` }] : [{ tone: "good", text: "Nada atrasado." }],
        summary: [`Ainda há ${money(sum(open))} em aberto neste mês, em ${plural(open.length, "conta", "contas")}.`, late.length ? `${money(sum(late))} já venceram: ${late.slice(0, 3).map((t) => t.name).join(", ")}.` : "Nada está atrasado.", soon[0] ? `A próxima é ${soon[0].name} em ${ddmm(soon[0].date)}.` : ""].filter(Boolean),
        context: { em_aberto: open.map((t) => ({ nome: t.name, valor: amount(t), data: t.date })) },
      };
    },
  },

  /** Patrimônio líquido: accounts and investments minus what is owed on the cards. */
  "patrimonio-liquido": {
    needs: ["accounts", "cards", "dashboard"],
    read: ({ accounts, cards, dashboard, money }) => {
      const inAccounts = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
      const invested = dashboard?.invested ?? 0;
      const debt = cards.filter((c) => c.active).reduce((s, c) => s + c.used, 0);
      const net = inAccounts + invested - debt;
      return {
        tile: "Patrimônio líquido", value: money(net), tone: net < 0 ? "expense" : undefined, note: `${money(inAccounts + invested)} − ${money(debt)} em cartões`,
        chart: { type: "segmented", total: Math.max(inAccounts + invested, debt, 0.01), segments: [{ value: Math.max(0, inAccounts), color: "var(--finnos-purple)", label: "Contas" }, { value: invested, color: "var(--income)", label: "Investido" }, { value: debt, color: "var(--expense)", striped: true, label: "Cartões a pagar" }] },
        rows: [{ label: "Nas contas", value: money(inAccounts) }, { label: "Investido", value: money(invested), tone: "income" }, { label: "Cartões (faturas e parcelas)", value: `−${money(debt)}`, tone: "expense" }, { label: "Patrimônio líquido", value: money(net), tone: net < 0 ? "expense" : "income" }],
        findings: [{ tone: net >= 0 ? "good" : "bad", text: net >= 0 ? `Depois de pagar os cartões, sobram ${money(net)}.` : `As dívidas dos cartões passam o que você tem em ${money(-net)}.` }],
        summary: [`Você tem ${money(inAccounts)} nas contas${invested ? ` e ${money(invested)} investidos` : ""}.`, `Nos cartões há ${money(debt)} a pagar, contando as parcelas futuras.`, `O patrimônio líquido é ${money(net)}.`],
        context: { contas: inAccounts, investido: invested, cartoes: debt, liquido: net },
      };
    },
  },

  /** Para revisar: entries without a category or registered automatically far above the usual. */
  "a-revisar": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const pick = (txs: Transaction[]) => txs.filter((t) => t.type !== "transferencia" && !t.invoice_payment && (!t.category_id || t.capture_unusual));
      const list = pick(tx).sort((a, b) => b.date.localeCompare(a.date));
      const noCat = list.filter((t) => !t.category_id), unusual = list.filter((t) => t.capture_unusual);
      return {
        empty: list.length ? undefined : "Tudo categorizado e sem valores fora do normal.",
        tile: "Para revisar", value: String(list.length), tone: list.length ? "expense" : "income", note: list.length ? `${money(sum(list))} sem categoria ou fora do normal` : "nada pendente",
        vs: { c: compare(list.length, prevTx.length ? pick(prevTx).length : null, "lower"), label: "vs mês passado", format: "count" },
        rows: list.map((t) => ({ label: t.name, sub: `${ddmm(t.date)} · ${t.capture_unusual ? "valor fora do normal" : "sem categoria"}`, value: money(amount(t)) })),
        findings: [...(noCat.length ? [{ tone: "info" as const, text: `${plural(noCat.length, "lançamento", "lançamentos")} sem categoria: as análises por categoria ficam incompletas.` }] : []), ...(unusual.length ? [{ tone: "bad" as const, text: `${plural(unusual.length, "compra", "compras")} do Apple Pay bem acima do normal.` }] : [])],
        summary: list.length ? [`Há ${plural(list.length, "lançamento", "lançamentos")} para revisar neste mês.`, noCat.length ? `${noCat.length} sem categoria, somando ${money(sum(noCat))}.` : "", unusual.length ? `${unusual.length} com valor muito acima do normal.` : ""].filter(Boolean) : ["Nada para revisar: tudo tem categoria."],
        context: { revisar: list.map((t) => ({ nome: t.name, valor: amount(t), sem_categoria: !t.category_id, fora_do_normal: !!t.capture_unusual })) },
      };
    },
  },

  /** Gasto médio por compra: the average ticket of the purchases that are not fixed bills. */
  "ticket-medio": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const buys = (txs: Transaction[]) => spending(txs).filter((t) => !t.fixed && !t.recurrence);
      const list = buys(tx), prev = buys(prevTx);
      const avg = list.length ? sum(list) / list.length : 0;
      const byCat = [...groupBy(list, (t) => t.category_name ?? "Sem categoria").entries()].map(([name, ts]) => ({ name, avg: sum(ts) / ts.length, count: ts.length, color: ts[0].category_color ?? undefined })).sort((a, b) => b.avg - a.avg);
      return {
        empty: list.length ? undefined : "Nenhuma compra no mês ainda.",
        tile: "Por compra", value: money(avg), note: `média de ${plural(list.length, "compra", "compras")}`,
        vs: { c: compare(avg, prev.length ? sum(prev) / prev.length : null, "lower"), label: "vs mês passado", format: "money" },
        chart: byCat.length ? { type: "bars", data: byCat.slice(0, 5).map((c, i) => ({ label: c.name.slice(0, 8), value: c.avg, focus: i === 0, valueLabel: money(c.avg).replace(/,\d\d$/, "") })) } : undefined,
        rows: byCat.map((c) => ({ label: c.name, sub: plural(c.count, "compra", "compras"), value: money(c.avg), color: c.color })),
        findings: byCat[0] ? [{ tone: "info", text: `Em ${byCat[0].name} cada compra sai em média ${money(byCat[0].avg)}.` }] : [],
        summary: [`Neste mês cada compra custou em média ${money(avg)} (${plural(list.length, "compra", "compras")}, sem contar contas fixas).`, prev.length ? `No mês passado a média foi ${money(sum(prev) / prev.length)}.` : "", byCat[0] ? `A categoria com compra mais cara é ${byCat[0].name}.` : ""].filter(Boolean),
        context: { media: avg, compras: list.length, por_categoria: byCat },
      };
    },
  },

  /** Onde você mais compra: the places that take the most money, with how many times. */
  "onde-compra": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const by = (txs: Transaction[]) => [...groupBy(spending(txs).filter((t) => !t.fixed), (t) => merchant(t.name)).entries()].map(([key, ts]) => ({ key, name: ts[0].name.replace(/\s*\d+\/\d+$/, ""), count: ts.length, total: sum(ts), color: ts[0].category_color ?? undefined })).sort((a, b) => b.total - a.total);
      const list = by(tx), prev = new Map(by(prevTx).map((p) => [p.key, p.total]));
      return {
        empty: list.length ? undefined : "Nenhuma compra no mês ainda.",
        tile: "Onde mais compra", value: list[0]?.name ?? "—", note: list[0] ? `${list[0].count}x · ${money(list[0].total)}` : "",
        vs: { c: compare(list[0]?.total ?? 0, list[0] ? prev.get(list[0].key) ?? null : null, "lower"), label: "vs mês passado", format: "money" },
        chart: { type: "bars", data: list.slice(0, 5).map((p, i) => ({ label: p.name.slice(0, 8), value: p.total, focus: i === 0, valueLabel: `${p.count}x` })) },
        rows: list.slice(0, 15).map((p) => ({ label: p.name, sub: `${p.count}x${prev.has(p.key) ? ` · ${money(prev.get(p.key)!)} no mês passado` : " · novo neste mês"}`, value: money(p.total), color: p.color })),
        findings: list.filter((p) => p.count >= 4).slice(0, 2).map((p) => ({ tone: "info" as const, text: `${p.name}: ${p.count} vezes no mês, ${money(p.total / p.count)} cada.` })),
        summary: list[0] ? [`${list[0].name} é onde mais foi dinheiro: ${money(list[0].total)} em ${plural(list[0].count, "compra", "compras")}.`, list[1] ? `Depois vem ${list[1].name}, com ${money(list[1].total)}.` : "", list.find((p) => p.count >= 4) ? `${list.find((p) => p.count >= 4)!.name} é o que mais se repete.` : ""].filter(Boolean) : ["Ainda não há compras no mês."],
        context: { lugares: list.slice(0, 10) },
      };
    },
  },

  /** Parcelas que terminam: installments ending in the next months and how much each month frees. */
  "parcelas-terminam": {
    needs: ["allTx", "cards"],
    read: ({ allTx, cards, month, money }) => {
      const rules = new Map(cards.map((c) => [c.id, { closing_day: c.closing_day, next_closing: c.next_closing }]));
      const names = new Map(cards.map((c) => [c.id, c.name]));
      const plans = installmentPlans(allTx, month, null, rules).filter((p) => p.endMonth >= month);
      const monthly = (m: string) => plans.filter((p) => p.startMonth <= m && p.endMonth >= m).reduce((s, p) => s + p.value, 0);
      const next = Array.from({ length: 6 }, (_, i) => addMonth(month, i));
      const ending = plans.filter((p) => p.endMonth <= addMonth(month, 2)).sort((a, b) => a.endMonth.localeCompare(b.endMonth));
      const freed = ending.reduce((s, p) => s + p.value, 0);
      return {
        empty: plans.length ? undefined : "Nenhuma parcela em andamento.",
        tile: "Libera até 3 meses", value: money(freed), tone: freed > 0 ? "income" : undefined, note: `por mês · ${plural(ending.length, "parcela termina", "parcelas terminam")}`,
        chart: { type: "bars", data: next.map((m, i) => ({ label: short(m), value: monthly(m), focus: i === 0, future: i > 0, valueLabel: money(monthly(m)).replace(/,\d\d$/, "") })) },
        rows: [...plans].sort((a, b) => a.endMonth.localeCompare(b.endMonth)).map((p) => ({ label: p.name, sub: `${(p.cardId && names.get(p.cardId)) || p.where} · termina em ${shortMonthName(p.endMonth)}/${p.endMonth.slice(2, 4)}`, value: `${money(p.value)}/mês` })),
        findings: ending.length ? [{ tone: "good", text: `${ending.map((p) => p.name).slice(0, 3).join(", ")} ${ending.length === 1 ? "termina" : "terminam"} até ${shortMonthName(addMonth(month, 2))}: ${money(freed)} a menos por mês.` }] : [{ tone: "info", text: "Nenhuma parcela termina nos próximos 3 meses." }],
        summary: [`Você tem ${plural(plans.length, "parcela", "parcelas")} em andamento, ${money(monthly(month))} neste mês.`, ending.length ? `Até ${shortMonthName(addMonth(month, 2))} terminam ${plural(ending.length, "parcela", "parcelas")}, liberando ${money(freed)} por mês.` : "Nenhuma termina nos próximos três meses.", `Em ${shortMonthName(next[5])} as parcelas devem somar ${money(monthly(next[5]))}.`],
        context: { parcelas: plans.map((p) => ({ nome: p.name, valor: p.value, termina: p.endMonth })) },
      };
    },
  },
};

// The second batch (Meu orçamento and fifteen more) lives in catalog2.ts.
Object.assign(READERS, MORE_READERS);

export type CatalogId = keyof typeof READERS;
/** Used by tests and by the analysis page: the category slices of a dashboard, for categoryChanges. */
export type { CategorySlice };
