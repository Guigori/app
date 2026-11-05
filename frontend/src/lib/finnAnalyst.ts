/**
 * FINNOS IA, analyst part: answers a parsed question with the user's own data, a visual,
 * something it noticed on its own and the next questions worth asking. Pure: `answer()`
 * receives the data, so it is tested without the app and runs in every mode.
 */
import { addMonth, formatDate } from "@/lib/format";
import { norm, type Entity, type FinnQuery, type Period } from "@/lib/finnQuestion";
import type { FinnVisual } from "@/lib/aiConversations";
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
  for (const e of entities) kinds.set(e.kind, [...(kinds.get(e.kind) ?? []), e]);
  return [...kinds.values()].every((group) => group.some((e) => entityMatch(tx, e)));
}

const counts = (tx: Transaction) => tx.type !== "transferencia" && !tx.invoice_payment && !tx.invoice_refund;
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

/** An establishment keeps the spelling of its lançamentos ("Ônibus", not "Onibus"). */
function spelled(e: Entity, data: AnalystData): Entity {
  if (e.kind !== "merchant") return e;
  for (const tx of data.transactions) {
    const word = tx.name.split(/\s+/).find((w) => norm(w) === e.term);
    if (word) return { ...e, name: word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1) };
  }
  return e;
}

/** Answers a parsed question with the user's data. */
export function answer(parsed: FinnQuery, data: AnalystData): FinnAnswer {
  const q = { ...parsed, entities: parsed.entities.map((e) => spelled(e, data)) };
  switch (q.op) {
    case "top": return topAnswer(q, data);
    case "save": return topAnswer({ ...q, type: "despesa" }, data, true);
    case "trend": return trendAnswer(q, data);
    case "compare": return compareAnswer(q, data);
    case "balance": return balanceAnswer(q, data);
    case "forecast": return forecastAnswer(q, data);
    case "upcoming": return upcomingAnswer(q, data);
    case "budget": return budgetAnswer(q, data);
    case "subscriptions": return subscriptionsAnswer(q, data);
    case "radar": return radarAnswer(q, data);
    default: return totalAnswer(q, data);
  }
}
