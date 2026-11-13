/**
 * FINNOS IA, analyst part: answers a parsed question with the user's own data, a visual,
 * something it noticed on its own and the next questions worth asking. Pure: `answer()`
 * receives the data, so it is tested without the app and runs in every mode.
 */
import { addMonth, formatDate } from "@/lib/format";
import { norm, type Entity, type FinnQuery, type Period } from "@/lib/finnQuestion";
import type { FinnVisual } from "@/lib/aiConversations";
import { goalPlan, goalProgress } from "@/lib/goalProgress";
import type { FinnosGoal } from "@/lib/goals";
import type {
  Account, BudgetCycleProgress, BudgetSummary, CalendarMonth, Category, Flow, RadarSignal, SubscriptionItem, Transaction,
} from "@/types/finnos";

export interface AnalystData {
  today: string;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budget?: BudgetSummary | null;
  cycle?: BudgetCycleProgress | null;
  calendar?: CalendarMonth | null;
  flow?: Flow | null;
  /** The next month's cash flow, when a question reaches into it ("dura até o dia 15?"). */
  nextFlow?: Flow | null;
  goals?: FinnosGoal[];
  subscriptions?: SubscriptionItem[];
  radar?: RadarSignal[];
}

export interface FinnAnswer {
  text: string;
  visual?: FinnVisual;
  /** Something the analyst noticed without being asked. */
  insight?: string;
  /** Next questions, sent as typed when tapped. */
  followUps: string[];
  links: { label: string; to: string }[];
  query: FinnQuery;
  /** What the analyst did to answer, shown as "✓ …" lines. */
  steps?: string[];
}

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v).replace(/ /g, " ");
const round = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);
const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "nos últimos 3 meses", "neste mês", "em outubro de 2026". */
const inP = (p: Period) => {
  const l = p.label;
  if (l === "hoje" || l === "ontem") return l;
  if (l === "este mês") return "neste mês";
  if (l === "esta semana") return "nesta semana";
  if (l === "semana passada") return "na semana passada";
  if (l.startsWith("últimos")) return `nos ${l}`;
  if (l.startsWith("últimas")) return `nas ${l}`;
  if (l === "período anterior") return "no período anterior";
  if (/meses anteriores$/.test(l)) return `nos ${l}`;
  return `em ${l}`;
};
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const times = (r: number) => (r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10).replace(".", ","));
const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortMonth = (m: string) => `${SHORT[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

function entityMatch(tx: Transaction, e: Entity): boolean {
  if (e.kind === "category") return tx.category_id === e.id;
  if (e.kind === "account") return tx.account_id === e.id || tx.to_account_id === e.id;
  if (e.kind === "card") return tx.card_id === e.id;
  return norm(tx.name).split(" ").includes(e.term) || norm(tx.name) === e.term;
}

/** Same kind of entity: either one; different kinds: all of them ("uber no nubank"). */
function matchesAll(tx: Transaction, entities: Entity[]): boolean {
  const kinds = new Map<string, Entity[]>();
  // A goal is not something lançamentos belong to.
  for (const e of entities.filter((x) => x.kind !== "goal")) kinds.set(e.kind, [...(kinds.get(e.kind) ?? []), e]);
  return [...kinds.values()].every((group) => group.some((e) => entityMatch(tx, e)));
}

const counts = (tx: Transaction) => tx.type !== "transferencia" && !(tx.invoice_payment || tx.balance_adjustment) && !tx.invoice_refund;
const inPeriod = (tx: Transaction, p: Period) => tx.date >= p.start && tx.date <= p.end;

function rowsFor(data: AnalystData, q: FinnQuery, p: Period, entities = q.entities) {
  const rows = data.transactions.filter((tx) => counts(tx) && tx.type === q.type && inPeriod(tx, p) && matchesAll(tx, entities));
  const paid = rows.filter((tx) => tx.status === "pago");
  const planned = rows.filter((tx) => tx.status !== "pago");
  const sum = (xs: Transaction[]) => round(xs.reduce((s, tx) => s + tx.value, 0));
  return { rows, paid, planned, total: sum(paid), plannedTotal: sum(planned) };
}

function subjectOf(q: FinnQuery): string {
  if (!q.entities.length) return q.type === "receita" ? "suas receitas" : "suas despesas";
  return q.entities.map((e) => e.name).join(" e ");
}

function linksFor(q: FinnQuery): FinnAnswer["links"] {
  const month = q.period.end.slice(0, 7);
  const category = q.entities.find((e) => e.kind === "category");
  const account = q.entities.find((e) => e.kind === "account");
  const metric = q.type === "receita" ? "receitas" : "despesas";
  const extra = `${category ? `&category_id=${encodeURIComponent(category.id!)}` : ""}${account ? `&account_id=${encodeURIComponent(account.id!)}` : ""}`;
  return [
    { label: "Ver no Caixa", to: `/transacoes?aba=caixa&month=${month}&metric=${metric}${extra}` },
    { label: "Ver lançamentos", to: `/transacoes?month=${month}&metric=${metric}${category ? `&category_id=${encodeURIComponent(category.id!)}` : ""}` },
  ];
}

/** The Radar signal most related to the question, or the most urgent one, said in one line. */
function noticed(data: AnalystData, q: FinnQuery, skipBudget = false): string | undefined {
  const signals = (data.radar ?? []).filter((s) => s.type === "risk" || s.type === "deviation").filter((s) => !(skipBudget && s.id.startsWith("budget-")));
  const category = q.entities.find((e) => e.kind === "category");
  const related = category ? signals.find((s) => s.related_entity_id === category.id) : undefined;
  const pick = related ?? [...signals].sort((a, b) => b.score - a.score)[0];
  return pick ? `${pick.title}${pick.metric ? ` (${pick.metric})` : ""}.` : undefined;
}

function itemsOf(rows: Transaction[], n = 5) {
  return [...rows].sort((a, b) => b.value - a.value).slice(0, n)
    .map((tx) => ({ label: tx.name, value: money(tx.value), detail: `${formatDate(tx.date)} · ${tx.card_name ?? tx.account_name}${tx.status !== "pago" ? " · previsto" : ""}` }));
}

function totalAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const now = rowsFor(data, q, q.period);
  const before = rowsFor(data, q, q.previous);
  const subject = subjectOf(q);
  const verb = q.type === "receita" ? "Você recebeu" : "Você gastou";
  const change = pct(now.total, before.total);
  const lines = [now.paid.length
    ? `${verb} **${money(now.total)}** ${q.entities.length ? `com ${subject} ` : ""}${inP(q.period)}, em ${plural(now.paid.length, "lançamento", "lançamentos")}.`
    : `Não encontrei ${q.type === "receita" ? "receitas" : "gastos"} ${q.entities.length ? `com ${subject} ` : ""}confirmados ${inP(q.period)}.`];
  if (now.planned.length) lines.push(`Ainda ${now.planned.length === 1 ? "há" : "há"} **${money(now.plannedTotal)}** agendado ou pendente.`);
  if (before.total > 0) lines.push(`${cap(inP(q.previous))} foram ${money(before.total)} (${change >= 0 ? "+" : ""}${change}%).`);
  if (q.op === "count") lines.unshift(`Foram **${plural(now.paid.length, "vez", "vezes")}** ${inP(q.period)}.`);
  if (q.op === "average" && now.paid.length) {
    const months = Math.max(1, q.period.months.length);
    lines.unshift(`Em média, **${money(now.total / now.paid.length)}** por lançamento${months > 1 ? ` e ${money(now.total / months)} por mês` : ""}.`);
  }
  const term = q.entities[0]?.name ?? (q.type === "receita" ? "receitas" : "despesas");
  return {
    text: lines.join(" "),
    visual: now.paid.length ? {
      metrics: [
        { label: "Total", value: money(now.total), tone: q.type === "receita" ? "positive" : "negative" },
        { label: "Lançamentos", value: String(now.paid.length) },
        { label: `vs ${q.previous.label}`, value: before.total ? `${change >= 0 ? "+" : ""}${change}%` : "—", tone: change > 0 === (q.type === "despesa") ? "negative" : "positive" },
      ],
      items: itemsOf(now.paid),
    } : undefined,
    insight: noticed(data, q),
    followUps: [`Evolução de ${term} por mês`, `Maiores lançamentos de ${term} ${inP(q.period)}`, q.period.label === "este mês" ? "E no mês passado?" : "E este mês?"],
    links: linksFor(q),
    query: q,
  };
}

function topAnswer(q: FinnQuery, data: AnalystData, save = false): FinnAnswer {
  const now = rowsFor(data, q, q.period);
  if (q.single && now.paid.length) {
    const ranked = [...now.paid].sort((a, b) => b.value - a.value);
    const top = ranked[0];
    return {
      text: `${q.type === "receita" ? "Sua maior entrada" : "Seu maior gasto"} ${inP(q.period)} foi **${top.name}**, ${money(top.value)} em ${formatDate(top.date)} (${top.category_name ?? "sem categoria"}, ${top.card_name ?? top.account_name}). Ele representa ${share(top.value, now.total)}% do total do período.`,
      visual: { title: "Maiores lançamentos", items: itemsOf(ranked, 5) },
      insight: noticed(data, q),
      followUps: [top.category_id ? `Quanto gastei com ${top.category_name} ${inP(q.period)}?` : "Para onde foi meu dinheiro este mês?", `Evolução de ${top.name} por mês`],
      links: linksFor(q),
      query: q,
    };
  }
  if (q.entities.length) {
    return {
      text: now.paid.length
        ? `Os maiores lançamentos de ${subjectOf(q)} ${inP(q.period)} somam **${money(now.total)}**; o maior foi ${[...now.paid].sort((a, b) => b.value - a.value)[0].name}.`
        : `Não encontrei lançamentos de ${subjectOf(q)} ${inP(q.period)}.`,
      visual: now.paid.length ? { title: "Maiores lançamentos", items: itemsOf(now.paid, 8) } : undefined,
      insight: noticed(data, q),
      followUps: [`Evolução de ${q.entities[0].name} por mês`, `Quanto gastei com ${q.entities[0].name} no mês passado?`],
      links: linksFor(q),
      query: q,
    };
  }
  const groups = new Map<string, { name: string; total: number }>();
  for (const tx of now.paid) {
    const key = tx.category_id ?? "none";
    const g = groups.get(key) ?? { name: tx.category_name ?? "Sem categoria", total: 0 };
    g.total = round(g.total + tx.value);
    groups.set(key, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.total - a.total);
  const top = ranked[0];
  const top3 = ranked.slice(0, 3);
  const freed = round(top3.reduce((s, g) => s + g.total, 0) * 0.1);
  const text = !top ? `Não encontrei ${q.type === "receita" ? "receitas" : "despesas"} confirmadas ${inP(q.period)}.`
    : save
      ? `Eu começaria pelos três maiores grupos ${inP(q.period)}: ${top3.map((g) => `${g.name} (${money(g.total)})`).join(", ")}. Reduzir 10% neles libera cerca de **${money(freed)}** por mês, sem cortes cegos.`
      : `O maior peso ${inP(q.period)} está em **${top.name}**: ${money(top.total)}, ou ${share(top.total, now.total)}% ${q.type === "receita" ? "das receitas" : "das despesas"}.`;
  return {
    text,
    visual: top ? {
      title: q.type === "receita" ? "De onde veio" : "Para onde foi",
      chart: { type: "donut", data: ranked.slice(0, 6).map((g) => ({ name: g.name, value: g.total })) },
      items: ranked.slice(0, 5).map((g) => ({ label: g.name, value: money(g.total), detail: `${share(g.total, now.total)}% do total` })),
    } : undefined,
    insight: noticed(data, q),
    followUps: top ? [`Maiores lançamentos de ${top.name}`, `Evolução de ${top.name} por mês`, "Quanto ainda posso gastar no orçamento?"] : ["Quanto gastei no mês passado?"],
    links: linksFor(q),
    query: q,
  };
}

function trendAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const months = q.period.months.length >= 2 ? q.period.months : Array.from({ length: 6 }, (_, i) => addMonth(q.period.end.slice(0, 7), i - 5));
  const series = months.map((m) => {
    const end = `${m}-31`;
    return { name: shortMonth(m), month: m, value: rowsFor(data, q, { start: `${m}-01`, end, label: m, months: [m] }).total };
  });
  const withData = series.filter((s) => s.value > 0);
  const peak = [...series].sort((a, b) => b.value - a.value)[0];
  const avg = round(series.reduce((s, x) => s + x.value, 0) / series.length);
  const last = series[series.length - 1], first = series[0];
  const direction = pct(last.value, first.value);
  return {
    text: withData.length
      ? `${subjectOf(q).charAt(0).toUpperCase() + subjectOf(q).slice(1)} nos últimos ${series.length} meses: média de **${money(avg)}** por mês. O mês mais alto foi ${peak.name} (${money(peak.value)})${first.value ? `, e de ${first.name} para ${last.name} a variação foi de ${direction >= 0 ? "+" : ""}${direction}%` : ""}.`
      : `Não encontrei ${subjectOf(q)} nos últimos ${series.length} meses.`,
    visual: withData.length ? { title: "Por mês", chart: { type: "bar", data: series.map(({ name, value }) => ({ name, value })), valueLabel: "Total" } } : undefined,
    insight: noticed(data, q),
    followUps: [`Maiores lançamentos de ${q.entities[0]?.name ?? "despesas"} em ${peak?.name ?? "outubro"}`, "Compare este mês com o mês passado"],
    links: linksFor(q),
    query: q,
  };
}

function compareAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  if (q.entities.length >= 2) {
    const parts = q.entities.map((e) => ({ e, ...rowsFor(data, q, q.period, [e]) }));
    const [a, b] = [...parts].sort((x, y) => y.total - x.total);
    const ratio = b.total ? round(a.total / b.total) : 0;
    return {
      text: `${cap(inP(q.period))}, ${parts.map((p) => `${p.e.name}: **${money(p.total)}** em ${plural(p.paid.length, "lançamento", "lançamentos")}`).join("; ")}.` +
        (a.total && b.total ? ` ${a.e.name} custou ${times(ratio)}× mais que ${b.e.name}.` : ""),
      visual: { title: cap(q.period.label), chart: { type: "bar", data: parts.map((p) => ({ name: p.e.name, value: p.total })), valueLabel: "Total" } },
      insight: noticed(data, q),
      followUps: q.entities.map((e) => `Evolução de ${e.name} por mês`).slice(0, 2),
      links: linksFor({ ...q, entities: [] }),
      query: q,
    };
  }
  const now = rowsFor(data, q, q.period), before = rowsFor(data, q, q.previous);
  const change = pct(now.total, before.total);
  return {
    text: `${subjectOf(q).charAt(0).toUpperCase() + subjectOf(q).slice(1)}: **${money(now.total)}** ${inP(q.period)} contra ${money(before.total)} ${inP(q.previous)}` +
      (before.total ? ` (${change >= 0 ? "+" : ""}${change}%, ${money(Math.abs(now.total - before.total))} ${now.total >= before.total ? "a mais" : "a menos"}).` : "."),
    visual: { chart: { type: "bar", data: [{ name: q.previous.label, value: before.total }, { name: q.period.label, value: now.total }], valueLabel: "Total" } },
    insight: noticed(data, q),
    followUps: [`Maiores lançamentos de ${q.entities[0]?.name ?? "despesas"} ${inP(q.period)}`, "Para onde foi meu dinheiro este mês?"],
    links: linksFor(q),
    query: q,
  };
}

function balanceAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const active = data.accounts.filter((a) => a.active !== false);
  const total = round(active.reduce((s, a) => s + a.balance, 0));
  return {
    text: `Seu saldo em contas é **${money(total)}**, somando ${plural(active.length, "conta", "contas")}.`,
    visual: { items: [...active].sort((a, b) => b.balance - a.balance).map((a) => ({ label: a.name, value: money(a.balance), detail: a.institution ?? undefined })) },
    insight: noticed(data, q),
    followUps: ["Vou fechar o mês no positivo?", "O que ainda vence este mês?"],
    links: [{ label: "Abrir Carteira", to: "/contas" }],
    query: q,
  };
}

function forecastAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const c = data.calendar;
  const coming = (data.flow?.upcoming ?? []).filter((u) => u.date >= data.today);
  const out = round(coming.filter((u) => u.type === "despesa").reduce((s, u) => s + u.value, 0));
  const income = round(coming.filter((u) => u.type === "receita").reduce((s, u) => s + u.value, 0));
  const close = c?.projected_balance ?? 0;
  return {
    text: c ? `Com o que está lançado e previsto, o mês deve fechar ${close >= 0 ? "com sobra de" : "faltando"} **${money(Math.abs(close))}**. Ainda devem entrar ${money(income || c.projected_income)} e sair ${money(out || c.projected_expense)}.` : "Ainda não consegui calcular a projeção do mês.",
    visual: c ? {
      metrics: [
        { label: "Entrou", value: money(c.income), tone: "positive" },
        { label: "Saiu", value: money(c.expense), tone: "negative" },
        { label: "Fecha em", value: money(close), tone: close >= 0 ? "positive" : "negative" },
      ],
      items: coming.slice(0, 6).map((u) => ({ label: u.name, value: `${u.type === "receita" ? "+" : "−"}${money(u.value)}`, detail: `${formatDate(u.date)} · ${u.kind}` })),
    } : undefined,
    insight: noticed(data, q),
    followUps: ["O que ainda vence este mês?", "Onde posso economizar?"],
    links: [{ label: "Ver projeção no Caixa", to: `/transacoes?aba=caixa&month=${data.today.slice(0, 7)}&metric=projecao` }],
    query: q,
  };
}

function upcomingAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const items = (data.flow?.upcoming ?? []).filter((u) => u.type === "despesa");
  const late = items.filter((u) => u.date < data.today && (u.kind === "pendente" || u.kind === "agendado"));
  const total = round(items.reduce((s, u) => s + u.value, 0));
  return {
    text: items.length ? `Até o fim do mês ainda saem **${money(total)}** em ${plural(items.length, "compromisso", "compromissos")}.${late.length ? ` ${plural(late.length, "está atrasado", "estão atrasados")}.` : ""}` : "Não há mais nada previsto para sair este mês.",
    visual: items.length ? { title: "Ainda vai sair", items: items.slice(0, 8).map((u) => ({ label: u.name, value: money(u.value), detail: `${formatDate(u.date)} · ${u.date < data.today && (u.kind === "pendente" || u.kind === "agendado") ? "atrasado" : u.kind}` })) } : undefined,
    insight: noticed(data, q),
    followUps: ["Vou fechar o mês no positivo?", "Quais assinaturas eu pago?"],
    links: [{ label: "Ver no Caixa", to: `/transacoes?aba=caixa&month=${data.today.slice(0, 7)}&metric=despesas` }],
    query: q,
  };
}

function budgetAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const category = q.entities.find((e) => e.kind === "category");
  const rows = data.cycle
    ? data.cycle.allocations.filter((a) => a.planned > 0).map((a) => ({ id: a.category_id, name: a.name ?? "Categoria", planned: a.planned, used: a.projected_close, left: a.available }))
    : (data.budget?.rows ?? []).filter((r) => r.budget > 0).map((r) => ({ id: r.category_id, name: r.name, planned: r.budget, used: r.spent, left: r.budget - r.spent }));
  const shown = category ? rows.filter((r) => r.id === category.id) : rows;
  if (!shown.length) {
    return { text: category ? `${category.name} não tem limite no orçamento.` : "Você ainda não definiu limites no orçamento.", followUps: ["Para onde foi meu dinheiro este mês?"], links: [{ label: "Configurar orçamento", to: "/orcamento/configuracoes" }], query: q };
  }
  const left = round(shown.reduce((s, r) => s + r.left, 0));
  const over = shown.filter((r) => r.left < 0);
  const daysLeft = Math.max(1, Number((data.cycle?.end_date ?? `${data.today.slice(0, 7)}-31`).slice(8, 10)) - Number(data.today.slice(8, 10)) + 1);
  return {
    text: `${category ? `Em ${category.name}, ` : ""}${left >= 0 ? `ainda restam **${money(left)}**` : `você passou **${money(-left)}** do limite`}${left > 0 ? `, cerca de ${money(left / daysLeft)} por dia até o fim do ${data.cycle ? "ciclo" : "mês"}` : ""}.` +
      (over.length && !category ? ` ${over.map((r) => r.name).join(", ")} já ${over.length === 1 ? "passou" : "passaram"} do limite.` : ""),
    visual: { items: [...shown].sort((a, b) => a.left - b.left).map((r) => ({ label: r.name, value: r.left >= 0 ? `restam ${money(r.left)}` : `${money(-r.left)} acima`, detail: `${money(r.used)} de ${money(r.planned)} · ${share(r.used, r.planned)}%` })) },
    insight: noticed(data, q, true),
    followUps: over.length ? [`Maiores lançamentos de ${over[0].name}`, "Onde posso economizar?"] : ["Onde posso economizar?", "Vou fechar o mês no positivo?"],
    links: [{ label: "Abrir orçamento", to: "/orcamento" }],
    query: q,
  };
}

function subscriptionsAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const active = (data.subscriptions ?? []).filter((s) => s.active);
  const monthly = round(active.reduce((s, x) => s + (x.recurrence === "anual" ? x.value / 12 : x.value), 0));
  return {
    text: active.length ? `Você tem ${plural(active.length, "assinatura ativa", "assinaturas ativas")}, **${money(monthly)}** por mês (${money(monthly * 12)} por ano).` : "Você não tem assinaturas cadastradas na central.",
    visual: active.length ? { items: [...active].sort((a, b) => b.value - a.value).map((s) => ({ label: s.name, value: money(s.value), detail: `${s.recurrence} · próxima ${formatDate(s.next_charge)}` })) } : undefined,
    insight: noticed(data, q),
    followUps: ["Quanto gastei com assinaturas nos últimos 6 meses?", "O que ainda vence este mês?"],
    links: [{ label: "Abrir assinaturas", to: "/assinaturas" }],
    query: q,
  };
}

function radarAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const signals = [...(data.radar ?? [])].sort((a, b) => b.score - a.score);
  const urgent = signals.filter((s) => s.severity === "critical" || s.severity === "high");
  return {
    text: urgent.length ? `${plural(urgent.length, "ponto pede", "pontos pedem")} atenção agora. O principal: **${urgent[0].title}**${urgent[0].metric ? ` (${urgent[0].metric})` : ""}.` : signals.length ? "Nada urgente agora. Separei o que vale acompanhar." : "O Radar não encontrou nada que mereça atenção agora.",
    visual: signals.length ? { items: signals.slice(0, 6).map((s) => ({ label: s.title, value: s.metric ?? "", detail: s.description })) } : undefined,
    followUps: ["Onde posso economizar?", "Vou fechar o mês no positivo?"],
    links: [{ label: "Abrir Radar", to: "/radar" }],
    query: q,
  };
}

const expenseRows = (data: AnalystData, from: string, to: string) =>
  data.transactions.filter((tx) => tx.type === "despesa" && tx.status === "pago" && counts(tx) && tx.date >= from && tx.date <= to);
const isoDay = (month: string, day: number) => {
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

/** "Onde estou gastando mais que o normal?": this month so far against the same days of the 3 previous months. */
function unusualAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const month = data.today.slice(0, 7);
  const day = Number(data.today.slice(8, 10));
  const byCategory = (rows: Transaction[]) => {
    const out = new Map<string, { name: string; total: number }>();
    for (const tx of rows) {
      const key = tx.category_id ?? "none";
      const g = out.get(key) ?? { name: tx.category_name ?? "Sem categoria", total: 0 };
      g.total += tx.value;
      out.set(key, g);
    }
    return out;
  };
  const now = byCategory(expenseRows(data, `${month}-01`, data.today));
  const past = [1, 2, 3].map((n) => addMonth(month, -n)).map((m) => byCategory(expenseRows(data, `${m}-01`, isoDay(m, day))));
  const rows = [...now.entries()].map(([key, g]) => {
    const usual = past.reduce((s, map) => s + (map.get(key)?.total ?? 0), 0) / 3;
    return { name: g.name, now: round(g.total), usual: round(usual), diff: round(g.total - usual) };
  }).filter((r) => r.diff >= 5).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const top = rows[0];
  const ratio = top && top.usual ? top.now / top.usual : null;
  return {
    text: top
      ? `${top.name} está ${ratio && ratio >= 1.8 ? `${times(ratio)}× o normal` : `**${money(top.diff)}** acima do normal`} até hoje (${money(top.now)} contra ${money(top.usual)} nos mesmos dias de um mês comum). Voltando ao normal, você economiza cerca de **${money(top.diff)}** por mês.`
      : "Nada está acima do normal neste mês até agora.",
    visual: rows.length ? { title: "Acima de um mês comum", chart: { type: "hbar", data: rows.map((r) => ({ name: r.name, value: r.diff })) } } : undefined,
    insight: noticed(data, q),
    followUps: top ? [`Maiores lançamentos de ${top.name} neste mês`, `Evolução de ${top.name} por mês`] : ["Para onde foi meu dinheiro este mês?"],
    links: [{ label: "Ver no Caixa", to: `/transacoes?aba=caixa&month=${month}&metric=despesas` }],
    query: q,
    steps: [`Comparando com um mês comum (os mesmos ${day} dias dos 3 meses anteriores)`],
  };
}

/** "Meu dinheiro dura até o dia 15?": today's balance, the day-to-day pace and what is scheduled until then. */
function runwayAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const month = data.today.slice(0, 7);
  const todayDay = Number(data.today.slice(8, 10));
  const upcoming = [...(data.flow?.upcoming ?? []), ...(data.nextFlow?.upcoming ?? [])].filter((u) => u.date >= data.today);
  const payday = upcoming.find((u) => u.type === "receita");
  const target = q.day
    ? (q.day > todayDay ? isoDay(month, q.day) : isoDay(addMonth(month, 1), q.day))
    : payday?.date ?? isoDay(month, 31);
  const start = round(data.accounts.filter((a) => a.active !== false).reduce((s, a) => s + a.balance, 0));
  // Day-to-day spending: the last 30 days of paid expenses that are not fixed bills or installments.
  const from = new Date(`${data.today}T12:00:00`); from.setDate(from.getDate() - 29);
  const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
  // Kept unrounded: it is multiplied by the days, and only the shown figure is rounded.
  const pace = expenseRows(data, fromIso, data.today).filter((tx) => !tx.fixed && !tx.installment).reduce((s, tx) => s + tx.value, 0) / 30;
  const days = Math.max(1, Math.round((new Date(`${target}T12:00:00`).getTime() - new Date(`${data.today}T12:00:00`).getTime()) / 86_400_000));
  // The payday itself is what the question waits for, so it is not counted in.
  const until = upcoming.filter((u) => u.date <= target && !(payday && u === payday && !q.day));
  const at = (iso: string) => {
    const elapsed = Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${data.today}T12:00:00`).getTime()) / 86_400_000);
    const scheduled = until.filter((u) => u.date <= iso).reduce((s, u) => s + (u.type === "receita" ? u.value : -u.value), 0);
    return round(start - pace * elapsed + scheduled);
  };
  const points = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(`${data.today}T12:00:00`); d.setDate(d.getDate() + Math.round((days * i) / 4));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { iso, name: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, value: at(iso) };
  });
  const end = points[points.length - 1].value;
  const firstNegative = points.find((p) => p.value < 0);
  const when = `${target.slice(8, 10)}/${target.slice(5, 7)}`;
  return {
    text: end >= 0
      ? `Sim. No seu ritmo atual, devem sobrar cerca de **${money(end)}** em ${when}.`
      : `Não: no seu ritmo atual, o saldo fica negativo por volta de ${firstNegative?.name ?? when}, e faltariam cerca de **${money(-end)}** em ${when}.`,
    visual: { title: "Saldo dia a dia", chart: { type: "line", data: points.map(({ name, value }) => ({ name, value })), valueLabel: "Saldo" } },
    insight: `Contei ${money(pace)} por dia de gastos do dia a dia (média dos últimos 30 dias) e ${plural(until.length, "lançamento previsto", "lançamentos previstos")} até ${when}.`,
    followUps: ["Onde estou gastando mais que o normal?", "O que ainda vence este mês?"],
    links: [{ label: "Ver projeção no Caixa", to: `/transacoes?aba=caixa&month=${month}&metric=projecao` }],
    query: q,
    steps: ["Calculando o seu ritmo de gastos", `Somando o que está previsto até ${when}`],
  };
}

/** "Quais meses custaram mais este ano e por quê?": totals per month and what weighed most in each. */
function monthsAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const months = q.period.months.filter((m) => m <= data.today.slice(0, 7));
  const rows = months.map((m) => {
    const txs = expenseRows(data, `${m}-01`, `${m}-31`);
    const byCat = new Map<string, number>();
    for (const tx of txs) byCat.set(tx.category_name ?? "Sem categoria", (byCat.get(tx.category_name ?? "Sem categoria") ?? 0) + tx.value);
    const [topName, topValue] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    return { month: m, total: round(txs.reduce((s, tx) => s + tx.value, 0)), topName, topValue: round(topValue) };
  });
  const ranked = rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  const [first, second] = ranked;
  const label = (m: string) => ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(m.slice(5, 7)) - 1];
  return {
    text: first
      ? `${cap(label(first.month))} liderou com **${money(first.total)}**, principalmente por causa de ${first.topName} (${money(first.topValue)}).${second ? ` Em seguida veio ${label(second.month)}, puxado por ${second.topName}.` : ""}`
      : `Não encontrei despesas ${inP(q.period)}.`,
    visual: ranked.length ? {
      title: "Despesas por mês",
      chart: { type: "bar", data: rows.map((r) => ({ name: shortMonth(r.month), value: r.total })), valueLabel: "Total" },
      items: ranked.slice(0, 5).map((r) => ({ label: cap(label(r.month)), value: money(r.total), detail: `principal: ${r.topName} (${money(r.topValue)})` })),
    } : undefined,
    insight: noticed(data, q),
    followUps: first ? [`Maiores lançamentos de ${label(first.month)}`, `Evolução de ${first.topName} por mês`] : ["Para onde foi meu dinheiro este mês?"],
    links: [{ label: "Ver no Caixa", to: `/transacoes?aba=caixa&month=${data.today.slice(0, 7)}&metric=despesas` }],
    query: q,
    steps: [`Comparando os meses desde ${label(months[0] ?? data.today.slice(0, 7))}`, "Vendo o que pesou em cada mês"],
  };
}

/** "Como estão minhas metas?", "quanto falta para o notebook?", "onde corto para chegar na meta?". */
function goalsAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const all = data.goals ?? [];
  const focusId = q.entities.find((e) => e.kind === "goal")?.id;
  const shown = focusId ? all.filter((g) => g.id === focusId) : all;
  const links = [{ label: "Abrir metas", to: "/metas" }];
  if (!shown.length) {
    return { text: "Você ainda não tem metas. Crie a primeira em Patrimônio → Metas, e eu acompanho com você.", followUps: ["Onde posso economizar?"], links, query: q, steps: ["Procurando suas metas"] };
  }
  const rows = shown.map((g) => {
    const account = data.accounts.find((a) => a.id === g.account);
    const p = goalProgress(g, account ? account.balance : null, data.today);
    return { g, p, plan: goalPlan(g, p.saved, data.today) };
  });
  // Where to cut: the three biggest expense categories of the last 3 months, 10% each.
  const from = `${addMonth(data.today.slice(0, 7), -3)}-01`;
  const to = `${addMonth(data.today.slice(0, 7), -1)}-31`;
  const byCat = new Map<string, number>();
  for (const tx of expenseRows(data, from, to)) byCat.set(tx.category_name ?? "Sem categoria", (byCat.get(tx.category_name ?? "Sem categoria") ?? 0) + tx.value / 3);
  const cuts = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, avg]) => ({ name, cut: round(avg * 0.1) }));
  const freed = round(cuts.reduce((s, c) => s + c.cut, 0));
  const lead = rows.find((r) => r.p.status !== "concluida") ?? rows[0];
  const monthName = (m: string | null) => (m ? ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(m.slice(5, 7)) - 1] + ` de ${m.slice(0, 4)}` : null);
  const pace = lead.plan.pacePerMonth || (lead.g.contribution * (lead.g.frequency === "Semanal" ? 52 : lead.g.frequency === "Quinzenal" ? 26 : 12)) / 12;
  const sooner = freed > 0 && lead.plan.remaining > 0 && pace > 0
    ? Math.ceil(lead.plan.remaining / pace) - Math.ceil(lead.plan.remaining / (pace + freed)) : 0;
  const one = rows.length === 1 || Boolean(focusId);
  const text = one
    ? lead.p.status === "concluida"
      ? `A meta **${lead.g.name}** está concluída: ${money(lead.p.saved)} guardados.`
      : `Na meta **${lead.g.name}** você tem ${money(lead.p.saved)} de ${money(lead.g.target)} (${Math.round(lead.p.percent)}%). Faltam **${money(lead.plan.remaining)}**` +
        (lead.plan.neededPerMonth && lead.plan.deadline ? `: ${money(lead.plan.neededPerMonth)} por mês para chegar em ${monthName(lead.plan.deadline)}.` : ".") +
        (lead.plan.finishAtPace ? ` No ritmo em que você tem guardado, termina em ${monthName(lead.plan.finishAtPace)}.` : "") +
        (lead.p.status === "atrasada" ? ` Está ${money(lead.p.behindBy)} atrás do plano.` : "")
    : `Você tem ${plural(rows.length, "meta", "metas")}: ${money(rows.reduce((s, r) => s + r.p.saved, 0))} guardados de ${money(rows.reduce((s, r) => s + r.g.target, 0))}. ` +
      `${rows.filter((r) => r.p.status === "atrasada").length ? `${plural(rows.filter((r) => r.p.status === "atrasada").length, "está atrasada", "estão atrasadas")}.` : "Todas no ritmo."}`;
  const tip = cuts.length && lead.p.status !== "concluida"
    ? `Cortando 10% de ${cuts.map((c) => c.name).join(", ")} você libera cerca de ${money(freed)} por mês${sooner > 0 ? ` e chega na meta ${lead.g.name} ${plural(sooner, "mês", "meses")} antes` : ""}.`
    : undefined;
  return {
    text,
    visual: {
      items: rows.map((r) => ({ label: r.g.name, value: `${money(r.p.saved)} de ${money(r.g.target)}`, detail: r.p.status === "concluida" ? "concluída" : `faltam ${money(r.plan.remaining)}${r.plan.neededPerMonth ? ` · ${money(r.plan.neededPerMonth)}/mês` : ""}${r.p.status === "atrasada" ? " · atrasada" : ""}` })),
      ...(cuts.length && lead.p.status !== "concluida" ? { chart: { type: "hbar" as const, data: cuts.map((c) => ({ name: c.name, value: c.cut })), prefix: "" }, title: "Cortando 10%, por mês" } : {}),
    },
    insight: tip,
    followUps: [one ? "Como estão todas as minhas metas?" : `Quanto falta para ${lead.g.name}?`, "Onde estou gastando mais do que o normal?"],
    links,
    query: q,
    steps: ["Lendo suas metas", "Comparando com o que sobra por mês"],
  };
}

/** An establishment keeps the spelling of its lançamentos ("Ônibus", not "Onibus"). */
/** Ready ideas per kind of spending (matched on the category or establishment name). */
const SAVE_TIPS: Array<[RegExp, string[]]> = [
  [/academia|smart ?fit|bluefit|crossfit|pilates|gym|personal/, ["Veja se usa a academia o bastante para o plano: abaixo de 2 vezes por semana, um plano mais simples ou por aula sai mais barato.", "Planos anuais ou recorrentes costumam custar menos por mês; benefícios como Gympass/Wellhub pela empresa também.", "Treino ao ar livre ou em casa alguns dias da semana pode substituir aulas extras pagas."]],
  [/saude|farmacia|drogaria|medic|consulta|exame|dentist|plano de saude/, ["Peça o genérico na farmácia: costuma custar de 30% a 60% menos que o de marca.", "Compare o preço do remédio em 2 ou 3 farmácias ou apps antes de comprar; os programas de desconto do laboratório (pelo CPF) também baixam o valor.", "Consultas e exames: veja o que o plano cobre ou se há reembolso antes de pagar particular.", "Se o plano de saúde pesa, compare a coparticipação ou um plano de rede menor no próximo reajuste."]],
  [/restaurante|lanche|ifood|delivery|bar\b|padaria|cafe|alimentacao fora/, ["Defina quantos pedidos de delivery por semana cabem e deixe o resto para comida de casa.", "Taxa de entrega e serviço somam muito: retirar no local ou pedir com cupom corta parte disso.", "Levar marmita 2 ou 3 dias na semana costuma economizar mais do que cortar tudo de uma vez."]],
  [/mercado|supermercado|alimentacao|feira|hortifruti/, ["Vá ao mercado com lista e um valor máximo por compra.", "Compare marcas próprias e compre os básicos em atacarejo uma vez por mês.", "Menos idas por semana = menos compras por impulso."]],
  [/transporte|uber|99|taxi|combustivel|gasolina|posto|estacionamento|pedagio/, ["Junte trajetos curtos no mesmo dia e compare app × transporte público nas rotas mais frequentes.", "Combustível: abasteça no posto mais barato da sua rota (apps de preço ajudam) e calibre os pneus.", "Corridas em horário de pico custam mais; sair 15 minutos antes ou depois já muda o preço."]],
  [/assinatura|streaming|netflix|spotify|disney|prime|max\b|youtube/, ["Liste as assinaturas e cancele as que você não usou no último mês.", "Faça rodízio: um streaming por vez, trocando a cada mês.", "Planos família ou anuais saem mais baratos por mês se você vai manter."]],
  [/lazer|entretenimento|cinema|show|viagem|passeio/, ["Defina um valor de lazer para o mês e acompanhe quanto sobra dele.", "Programe os passeios caros e alterne com programas gratuitos."]],
  [/compras|roupa|vestuario|shopping|eletronic|casa|decoracao|marketplace/, ["Espere 48 horas antes de compras que não são essenciais.", "Tire os cartões salvos dos sites e apps de compra para criar um passo a mais.", "Compare preços e use cashback antes de comprar."]],
  [/moradia|aluguel|condominio|energia|luz|agua|gas\b|internet|telefone|celular/, ["Revise o plano de internet e celular: muitas vezes há um plano menor ou uma oferta de retenção.", "Na energia, os maiores vilões são chuveiro, ar-condicionado e geladeira antiga.", "Pergunte por desconto para pagamento em dia ou débito automático."]],
  [/educacao|curso|escola|faculdade|livro/, ["Veja bolsas, descontos para pagamento à vista ou convênios da empresa.", "Cursos gratuitos e bibliotecas cobrem boa parte do conteúdo."]],
  [/pet|veterin/, ["Ração em embalagem maior ou por assinatura sai mais barata por quilo.", "Planos de saúde pet só compensam se o uso for frequente; compare com o que você gastou no ano."]],
];

/** "O que gastei em saúde e como economizar?": where the money went, how it compares and what to do about it. */
function saveAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const entity = q.entities[0];
  const month = q.period.end.slice(0, 7);
  const now = rowsFor(data, q, q.period);
  const monthPeriod = (m: string): Period => ({ start: `${m}-01`, end: `${m}-31`, label: m, months: [m] });
  const history = [1, 2, 3].map((n) => { const m = addMonth(month, -n); return { m, total: rowsFor(data, q, monthPeriod(m)).total }; });
  const withData = history.filter((h) => h.total > 0);
  const avg = withData.length ? round(withData.reduce((s, h) => s + h.total, 0) / withData.length) : 0;
  // Where it went: grouped by establishment, biggest first.
  const byName = new Map<string, { name: string; total: number; n: number }>();
  for (const tx of now.paid) { const k = norm(tx.name); const g = byName.get(k) ?? { name: tx.name, total: 0, n: 0 }; g.total = round(g.total + tx.value); g.n += 1; byName.set(k, g); }
  const places = [...byName.values()].sort((a, b) => b.total - a.total);
  const allSpend = rowsFor(data, q, q.period, []).total;
  const subject = entity.name;
  if (!now.paid.length && !avg) {
    return { text: `Não encontrei gastos com **${subject}** ${inP(q.period)} nem nos três meses anteriores, então não há o que cortar aí por enquanto.`, followUps: ["Onde posso economizar este mês?", "Para onde foi meu dinheiro este mês?"], links: linksFor(q), query: q };
  }
  const parts: string[] = [];
  parts.push(`${cap(inP(q.period))} você gastou **${money(now.total)}** com ${subject}${now.paid.length ? ` em ${plural(now.paid.length, "lançamento", "lançamentos")}` : ""}${allSpend ? ` (${share(now.total, allSpend)}% das despesas)` : ""}.`);
  if (avg) {
    const diff = round(now.total - avg);
    parts.push(diff > 0
      ? `Isso está **${money(diff)} acima** da sua média dos últimos meses (${money(avg)} por mês).`
      : `Está ${diff < 0 ? `${money(-diff)} abaixo` : "igual"} da sua média dos últimos meses (${money(avg)} por mês).`);
  }
  if (places.length) {
    const top = places.slice(0, 3).map((p) => `${p.name} (${money(p.total)}${p.n > 1 ? `, ${p.n}×` : ""})`).join(", ");
    parts.push(`O que mais pesou: ${top}.`);
  }
  const repeated = places.filter((p) => p.n >= 3);
  const base = Math.max(now.total, avg);
  const target = round(base * 0.15);
  const ideas: string[] = [];
  if (avg && now.total > avg * 1.1) ideas.push(`Voltar para a sua média já libera **${money(round(now.total - avg))}** por mês.`);
  if (repeated.length) ideas.push(`${repeated[0].name} aparece ${repeated[0].n} vezes no mês: é aí que um limite por semana faz mais diferença.`);
  const key = `${norm(subject)} ${places.slice(0, 5).map((p) => norm(p.name)).join(" ")}`;
  const tips = SAVE_TIPS.find(([re]) => re.test(key))?.[1] ?? ["Defina um limite mensal para essa categoria no Orçamento e o FINNOS avisa quando você chegar perto.", "Revise os três maiores lançamentos: algum podia ter sido adiado ou trocado por uma opção mais barata?"];
  ideas.push(...tips.slice(0, 3));
  ideas.push(`Uma meta realista: cortar 15% (cerca de **${money(target)} por mês**, ${money(round(target * 12))} no ano).`);
  return {
    text: `${parts.join(" ")}\n\n**Como economizar com ${subject}:**\n${ideas.map((i) => `• ${i}`).join("\n")}`,
    visual: places.length ? { title: `Onde foi o gasto com ${subject}`, items: places.slice(0, 5).map((p) => ({ label: p.name, value: money(p.total), detail: plural(p.n, "vez", "vezes") })) } : undefined,
    insight: noticed(data, q),
    followUps: [`Crie um limite para ${subject} no orçamento`, `Evolução de ${subject} por mês`, "Onde mais posso economizar?"],
    links: linksFor(q),
    query: q,
  };
}

function spelled(e: Entity, data: AnalystData): Entity {
  if (e.kind !== "merchant") return e;
  for (const tx of data.transactions) {
    const word = tx.name.split(/\s+/).find((w) => norm(w) === e.term);
    if (word) return { ...e, name: word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1) };
  }
  return e;
}

/** Names in the data that look like what was asked ("padar" → "Padaria Real"), to suggest instead of guessing. */
function lookalikes(word: string, data: AnalystData): string[] {
  const pool = new Map<string, string>();
  for (const c of data.categories) pool.set(norm(c.name), c.name);
  for (const a of data.accounts) pool.set(norm(a.name), a.name);
  for (const tx of data.transactions) pool.set(norm(tx.name), tx.name);
  const w = word.slice(0, Math.max(3, Math.min(5, word.length - 1)));
  return [...pool.entries()].filter(([k]) => k.split(" ").some((x) => x.startsWith(w) || (x.length >= 4 && word.startsWith(x.slice(0, 4))))).map(([, v]) => v).slice(0, 3);
}

/** Says plainly what was not found, instead of answering about something else. */
function notFoundAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const words = q.unknown ?? [];
  const asked = words.map((w) => `“${w}”`).join(" e ");
  const like = [...new Set(words.flatMap((w) => lookalikes(w, data)))];
  return {
    text: `Não encontrei ${asked} nos seus dados. Procurei nos lançamentos ${inP(q.period)}, nas categorias, contas e cartões, e nada tem esse nome.${like.length ? ` Talvez você quis dizer: ${like.map((x) => `**${x}**`).join(", ")}?` : " Se o gasto existe, ele pode estar com outro nome ou sem categoria."}`,
    followUps: like.length ? like.slice(0, 2).map((x) => `Quanto gastei com ${x} ${q.period.label}?`) : ["Para onde foi meu dinheiro este mês?", "Quais foram meus maiores gastos este mês?"],
    links: [{ label: "Buscar nos lançamentos", to: `/transacoes?month=${q.period.end.slice(0, 7)}` }],
    query: q,
    steps: [`Procurei ${asked} em lançamentos, categorias, contas e cartões`],
  };
}

/** "Quando foi a última vez que paguei o IPVA?", "procure Netflix": the lançamentos themselves, newest first. */
function findAnswer(q: FinnQuery, data: AnalystData): FinnAnswer {
  const rows = data.transactions.filter((tx) => tx.type !== "transferencia" && !(tx.invoice_payment || tx.balance_adjustment) && inPeriod(tx, q.period) && matchesAll(tx, q.entities))
    .sort((a, b) => b.date.localeCompare(a.date));
  const subject = q.entities.length ? q.entities.map((e) => e.name).join(" e ") : "o que você pediu";
  if (!rows.length) return { text: `Não encontrei lançamentos de **${subject}** ${inP(q.period)}.`, followUps: ["Para onde foi meu dinheiro este mês?"], links: linksFor(q), query: q, steps: [`Procurei ${subject} ${inP(q.period)}`] };
  const past = rows.filter((tx) => tx.date <= data.today);
  const next = rows.filter((tx) => tx.date > data.today).at(-1);
  const last = past[0];
  const paid = rows.filter((tx) => tx.status === "pago");
  const total = round(paid.reduce((s, tx) => s + tx.value, 0));
  const parts: string[] = [];
  if (last) parts.push(`A última vez foi em **${formatDate(last.date)}**: ${last.name}, ${money(last.value)} (${last.card_name ?? last.account_name}${last.status !== "pago" ? `, ${last.status}` : ""}).`);
  if (next) parts.push(`O próximo está previsto para ${formatDate(next.date)} (${money(next.value)}).`);
  parts.push(`Encontrei ${plural(rows.length, "lançamento", "lançamentos")} ${inP(q.period)}${paid.length ? `, somando ${money(total)} pagos` : ""}.`);
  if (paid.length >= 3) {
    const months = new Set(paid.map((tx) => tx.date.slice(0, 7))).size;
    parts.push(`Em média, ${money(round(total / Math.max(1, months)))} por mês em que aparece.`);
  }
  return {
    text: parts.join(" "),
    visual: { title: "Lançamentos encontrados", items: rows.slice(0, 8).map((tx) => ({ label: tx.name, value: money(tx.value), detail: `${formatDate(tx.date)} · ${tx.category_name ?? "sem categoria"} · ${tx.card_name ?? tx.account_name}${tx.status !== "pago" ? " · previsto" : ""}` })) },
    followUps: q.entities[0] ? [`Evolução de ${q.entities[0].name} por mês`, `Quanto gastei com ${q.entities[0].name} este mês?`] : [],
    links: linksFor(q),
    query: q,
    steps: [`Procurei ${subject} ${inP(q.period)}`],
  };
}

/** Answers a parsed question with the user's data. */
export function answer(parsed: FinnQuery, data: AnalystData): FinnAnswer {
  const q = { ...parsed, entities: parsed.entities.map((e) => spelled(e, data)) };
  if (q.unknown?.length && !q.entities.length) return notFoundAnswer(q, data);
  const result = answerFor(q, data);
  // Part of the question was not found: say so instead of quietly leaving it out.
  if (q.unknown?.length) result.text += `\n\nNão encontrei ${q.unknown.map((w) => `“${w}”`).join(" e ")} nos seus dados, então ficou de fora.`;
  return result;
}

function answerFor(q: FinnQuery, data: AnalystData): FinnAnswer {
  switch (q.op) {
    case "find": return findAnswer(q, data);
    case "top": return topAnswer(q, data);
    case "save": return q.entities.length ? saveAnswer({ ...q, type: "despesa" }, data) : topAnswer({ ...q, type: "despesa" }, data, true);
    case "trend": return trendAnswer(q, data);
    case "compare": return compareAnswer(q, data);
    case "balance": return balanceAnswer(q, data);
    case "forecast": return forecastAnswer(q, data);
    case "upcoming": return upcomingAnswer(q, data);
    case "budget": return budgetAnswer(q, data);
    case "subscriptions": return subscriptionsAnswer(q, data);
    case "radar": return radarAnswer(q, data);
    case "unusual": return unusualAnswer(q, data);
    case "runway": return runwayAnswer(q, data);
    case "months": return monthsAnswer(q, data);
    case "goals": return goalsAnswer(q, data);
    default: return totalAnswer(q, data);
  }
}
