/** Comportamento, Renda, Últimos 6 meses and Saldo das contas in the analysis library. */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchFlow } from "@/lib/data";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { compare, shortMonthName } from "@/lib/insights/compare";
import { incomeReading, lastMonths, spendingHabits, WEEKDAY_NAMES } from "@/lib/insights/habits";
import type { Finding } from "@/lib/insights/invoices";
import type { WidgetSize } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";
import { Bars, FINNOS_COLOR, Heatmap, ProjectionLine, SegmentedBar } from "@/components/charts/FinnosCharts";
import { FindingList, InsightShell, LABEL, NOTE, NUMBER_HERO, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { FinnSummary, VsLastMonth } from "@/components/insights/FinnSummary";
import { useAccounts, useBalanceHistory, useCalendar } from "@/components/insights/useInsightData";

type Props = { size: WidgetSize; to?: string; className?: string };
const Skeleton = ({ className }: { className?: string }) => <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
const useMoney = () => { const { hidden } = useBalanceHidden(); return { hidden, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)) }; };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** The focus month with the six before it (the flow brings two future months too, ignored here). */
const useFlow = (month: string) => useQuery({ queryKey: ["flow", "insights", month], queryFn: () => fetchFlow({ month, months: 6 }), staleTime: 60_000 });

/** Quando você gasta: the month as a heat map, the most expensive weekday, the peak day and the quiet days. */
export function HabitsInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const navigate = useNavigate();
  const month = currentMonth();
  const today = todayISO();
  const prevMonth = addMonth(month, -1);
  const calendar = useCalendar(month);
  const prevCalendar = useCalendar(prevMonth);
  if (!calendar.data) return <Skeleton className={className} />;
  const h = spendingHabits(calendar.data.days, today);
  const prev = prevCalendar.data ? spendingHabits(prevCalendar.data.days, `${prevMonth}-31`) : null;
  const vs = compare(h.perDay, prev?.perDay, "lower");
  const vsLine = <VsLastMonth c={vs} label={`por dia vs ${shortMonthName(prevMonth)}`} format={money} />;
  const values = Object.fromEntries(calendar.data.days.map((d) => [d.date, Math.max(0, d.expense)]));
  const openDay = (date: string) => navigate(`/transacoes?date=${date}`);
  if (size === "S") return (
    <Tile title="Dia mais caro" className={className} testId="habits-insight">
      <p className={cn(NUMBER_TILE, "truncate")}>{h.topWeekday ? cap(WEEKDAY_NAMES[h.topWeekday.weekday]) : "—"}</p>
      <p className={cn(NOTE, "mt-auto")}>{h.topWeekday ? `${money(h.topWeekday.average)} em média` : "Sem gastos no mês"}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Quando você gasta" className={className} testId="habits-insight">
      <div className="flex min-h-0 flex-1 items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className={NUMBER_TILE}>{money(h.perDay)}</p>
          <p className={cn(NOTE, "mt-1")}>por dia</p>
          <div className="mt-1"><VsLastMonth c={vs} label={`vs ${shortMonthName(prevMonth)}`} format={money} /></div>
          <p className={cn(NOTE, "mt-1 truncate")}>{h.quietDays} {h.quietDays === 1 ? "dia" : "dias"} sem gastar</p>
        </div>
        {hidden ? null : <Heatmap className="w-[46%] shrink-0" compact month={month} values={values} today={today} format={money} />}
      </div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (h.topWeekday) findings.push({ tone: "info", text: `${cap(WEEKDAY_NAMES[h.topWeekday.weekday])} é o dia mais caro: ${money(h.topWeekday.average)} em média.` });
  if (h.peak) findings.push({ tone: "info", text: `O maior gasto foi em ${ddmm(h.peak.date)}: ${money(h.peak.expense)}.` });
  if (h.weekendShare >= 0.5) findings.push({ tone: "bad", text: `${pct(h.weekendShare)} do que saiu foi de sexta a domingo.` });
  if (h.quietDays > 0) findings.push({ tone: "good", text: `${h.quietDays} ${h.quietDays === 1 ? "dia" : "dias"} sem gastar nada neste mês.` });
  const summary = [
    `Neste mês você gastou ${money(h.total)} em ${h.daysSoFar} dias, ${money(h.perDay)} por dia${vs && !vs.same ? `, ${vs.better ? `${money(-vs.delta)} a menos` : `${money(vs.delta)} a mais`} por dia que em ${shortMonthName(prevMonth)}` : ""}.`,
    findings[0]?.text ?? "",
    h.weekendShare >= 0.5 ? findings.find((f) => f.tone === "bad")!.text : h.quietDays ? `Foram ${h.quietDays} dias sem nenhum gasto.` : "",
  ].filter(Boolean);
  const peakWeek = Math.max(1, ...h.byWeekday.map((w) => w.average));
  return (
    <>{size === "XL" ? <FinnSummary title="Quando você gasta" sentences={summary} context={{ total: h.total, por_dia: h.perDay, dia_mais_caro: h.topWeekday ? WEEKDAY_NAMES[h.topWeekday.weekday] : null, fim_de_semana: pct(h.weekendShare), dias_sem_gastar: h.quietDays }} /> : null}
    <InsightShell title="Quando você gasta" subtitle={monthLabel(month)} to={to} className={className} testId="habits-insight">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0"><p className={LABEL}>Por dia</p><p className={cn(NUMBER_HERO, "mt-2")}>{hidden ? "R$ ••••" : formatBRL(h.perDay)}</p><div className="mt-1">{vsLine}</div></div>
        <div className="shrink-0 text-right"><p className={LABEL}>Sem gastar</p><p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{h.quietDays}<span className="text-sm text-muted-foreground"> de {h.daysSoFar}</span></p></div>
      </div>
      {hidden ? null : <Heatmap className="mt-5" month={month} values={values} today={today} format={money} onOpenDay={openDay} />}
      {size === "XL" && !hidden ? (
        <div className="mt-6">
          <p className={LABEL}>Média por dia da semana</p>
          <Bars className="mt-3" height={120} data={h.byWeekday.map((w) => ({ label: WEEKDAY_NAMES[w.weekday].slice(0, 3), value: w.average, focus: w.weekday === h.topWeekday?.weekday, valueLabel: w.average > 0 ? money(w.average).replace(/,\d\d$/, "") : "" }))} />
        </div>
      ) : null}
      <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? findings : findings.slice(0, 2)} /></div>
    </InsightShell></>
  );
}

/** Renda do mês: what already came in, what is still expected, and how much of it the month's spending takes. */
export function IncomeInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const flow = useFlow(month);
  if (!flow.data) return <Skeleton className={className} />;
  const f = flow.data;
  const months = lastMonths(f.series, month);
  const prev = months.months.find((p) => p.month === addMonth(month, -1));
  const r = incomeReading(f.income, f.expense, f.upcoming);
  const vs = compare(r.expected, prev?.income, "higher");
  const vsLine = <VsLastMonth c={vs} label={`vs ${shortMonthName(addMonth(month, -1))}`} format={money} />;
  const bar = <SegmentedBar format={money} height={10} total={Math.max(r.expected, 0.01)} segments={[{ value: r.received, color: FINNOS_COLOR.income, label: "Recebido" }, { value: r.toCome, color: FINNOS_COLOR.income, striped: true, label: "A receber" }]} />;
  if (size === "S") return (
    <Tile title="Renda do mês" className={className} testId="income-insight">
      <p className={cn(NUMBER_TILE, "text-income")}>{money(r.received)}</p>
      <p className={cn(NOTE, "mt-auto")}>{r.toCome > 0 ? `+ ${money(r.toCome)} a receber` : "recebido no mês"}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Renda do mês" className={className} testId="income-insight">
      <p className={cn(NUMBER_TILE, "text-income")}>{money(r.received)}</p>
      <p className={cn(NOTE, "mt-1")}>{r.toCome > 0 ? `recebido · ${money(r.toCome)} ainda entra` : "recebido no mês"}</p>
      <div className="mt-auto space-y-2">{bar}{vsLine}</div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (r.next[0]) findings.push({ tone: "info", text: `Ainda entra ${r.next[0].name} em ${ddmm(r.next[0].date)}: ${money(r.next[0].value)}.` });
  if (r.expected > 0) findings.push({ tone: r.committed > 1 ? "bad" : r.committed > 0.85 ? "info" : "good", text: r.committed > 1 ? `Os gastos do mês já passam a renda em ${money(f.expense - r.expected)}.` : `Os gastos do mês levam ${pct(r.committed)} da renda.` });
  if (r.expected === 0) findings.push({ tone: "info", text: "Nenhuma entrada registrada neste mês ainda." });
  const summary = [
    `Neste mês entraram ${money(r.received)}${r.toCome > 0 ? ` e ainda devem entrar ${money(r.toCome)}, ${money(r.expected)} no total` : ""}.`,
    findings.find((x) => x.text.startsWith("Os gastos"))?.text ?? "",
    vs && prev ? `Em ${shortMonthName(prev.month)} entraram ${money(prev.income)}; ${vs.same ? "este mês deve entrar o mesmo" : `este mês devem entrar ${money(Math.abs(vs.delta))} ${vs.delta > 0 ? "a mais" : "a menos"}`}.` : "",
  ].filter(Boolean);
  return (
    <>{size === "XL" ? <FinnSummary title="Renda do mês" sentences={summary} context={{ recebido: r.received, a_receber: r.toCome, gastos: f.expense, proximas: r.next.map((n) => ({ nome: n.name, data: n.date, valor: n.value })) }} /> : null}
    <InsightShell title="Renda do mês" subtitle={monthLabel(month)} to={to} className={className} testId="income-insight">
      <p className={LABEL}>Recebido</p>
      <p className={cn(NUMBER_HERO, "mt-2 text-income")}>{hidden ? "R$ ••••" : formatBRL(r.received)}</p>
      <p className={cn(NOTE, "mt-2")}>{r.toCome > 0 ? <>+ {money(r.toCome)} a receber · {money(r.expected)} no mês</> : "tudo o que era esperado"}</p>
      <div className="mt-1">{vsLine}</div>
      <div className="mt-4">{bar}</div>
      {r.next.length ? (
        <ul className="mt-4 space-y-2">
          {r.next.slice(0, size === "XL" ? 8 : 3).map((n, i) => <li key={i} className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate"><span className="text-muted-foreground">{ddmm(n.date)} · </span>{n.name}</span><span className="shrink-0 font-semibold tabular-nums text-income">{money(n.value)}</span></li>)}
        </ul>
      ) : null}
      <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? findings : findings.slice(-1)} /></div>
    </InsightShell></>
  );
}

/** Últimos 6 meses: what went out each month against the average, and how many months closed positive. */
export function MonthsInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const flow = useFlow(month);
  if (!flow.data) return <Skeleton className={className} />;
  const r = lastMonths(flow.data.series, month);
  const closed = r.months.filter((p) => p.month < month);
  const cur = r.current;
  const vs = compare(cur?.expense ?? 0, r.averageExpense || null, "lower");
  const short = (m: string) => cap(shortMonthName(m));
  const bars = r.months.map((p) => ({ label: short(p.month), value: p.expense, focus: p.month === month, valueLabel: hidden ? "" : money(p.expense).replace(/,\d\d$/, "") }));
  if (size === "S") return (
    <Tile title="Média de gastos" className={className} testId="months-insight">
      <p className={NUMBER_TILE}>{money(r.averageExpense)}</p>
      <p className={cn(NOTE, "mt-auto")}>por mês · {closed.length} meses</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Últimos 6 meses" className={className} testId="months-insight">
      <div className="flex items-baseline justify-between gap-3"><p className={NUMBER_TILE}>{money(r.averageExpense)}</p><span className={NOTE}>média/mês</span></div>
      {hidden ? null : <Bars className="mt-auto" height={70} data={bars.map((b) => ({ ...b, valueLabel: "" }))} />}
    </Tile>
  );
  const findings: Finding[] = [];
  if (cur && r.averageExpense > 0) findings.push({ tone: cur.expense > r.averageExpense ? "bad" : "good", text: cur.expense > r.averageExpense ? `${cap(shortMonthName(month))} já passa a média em ${money(cur.expense - r.averageExpense)}.` : `${cap(shortMonthName(month))} está ${money(r.averageExpense - cur.expense)} abaixo da média até agora.` });
  if (closed.length) findings.push({ tone: r.positive === closed.length ? "good" : r.positive === 0 ? "bad" : "info", text: `${r.positive} de ${closed.length} meses fecharam com mais entrando do que saindo.` });
  if (r.best && r.worst && r.best.month !== r.worst.month) findings.push({ tone: "info", text: `Melhor mês: ${shortMonthName(r.best.month)} (${money(r.best.net)}). Pior: ${shortMonthName(r.worst.month)} (${money(r.worst.net)}).` });
  const summary = [
    `Nos últimos ${closed.length} meses você gastou em média ${money(r.averageExpense)} e recebeu ${money(r.averageIncome)} por mês.`,
    findings[0]?.text ?? "", findings[1]?.text ?? "",
  ].filter(Boolean);
  return (
    <>{size === "XL" ? <FinnSummary title="Últimos 6 meses" sentences={summary} context={{ meses: r.months.map((p) => ({ mes: p.month, entrada: p.income, saida: p.expense, resultado: p.net })) }} /> : null}
    <InsightShell title="Últimos 6 meses" subtitle="O que saiu em cada mês" to={to} className={className} testId="months-insight">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0"><p className={LABEL}>Média por mês</p><p className={cn(NUMBER_HERO, "mt-2")}>{hidden ? "R$ ••••" : formatBRL(r.averageExpense)}</p>{cur ? <div className="mt-1"><VsLastMonth c={vs} label="este mês vs média" format={money} /></div> : null}</div>
      </div>
      {hidden ? null : <Bars className="mt-5" height={140} data={bars} />}
      {size === "XL" ? (
        <ul className="mt-5 divide-y divide-border/70 text-sm">
          {[...r.months].reverse().map((p) => (
            <li key={p.month} className="grid grid-cols-[1fr_auto_auto] gap-3 py-2.5 tabular-nums">
              <span>{cap(shortMonthName(p.month))} {p.month.slice(2, 4)}</span>
              <span className="text-income">{money(p.income)}</span>
              <span className={cn("w-24 text-right font-semibold", p.net < 0 ? "text-expense" : "")}>{p.net >= 0 ? "+" : "−"}{money(Math.abs(p.net))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? findings : findings.slice(0, 2)} /></div>
    </InsightShell></>
  );
}

/** Saldo das contas: the money in every account now, how it moved this month and where it is. */
export function AccountsInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const prevMonth = addMonth(month, -1);
  const accounts = useAccounts();
  const history = useBalanceHistory(month);
  const prevHistory = useBalanceHistory(prevMonth);
  if (!accounts.data || !history.data) return <Skeleton className={className} />;
  const list = accounts.data.filter((a) => a.active).sort((a, b) => b.balance - a.balance);
  const total = list.reduce((s, a) => s + a.balance, 0);
  const vs = compare(total, prevHistory.data?.balance, "higher");
  const vsLine = <VsLastMonth c={vs} label={`vs fim de ${shortMonthName(prevMonth)}`} format={money} />;
  const points = [{ value: history.data.opening_balance, kind: "real" as const, label: "início" }, ...history.data.days.map((d) => ({ value: d.balance, kind: "real" as const, label: ddmm(d.date) }))];
  const change = total - history.data.opening_balance;
  const negative = list.filter((a) => a.balance < 0);
  if (size === "S") return (
    <Tile title="Nas contas" className={className} testId="accounts-insight">
      <p className={cn(NUMBER_TILE, total < 0 && "text-expense")}>{money(total)}</p>
      <p className={cn(NOTE, "mt-auto")}>{list.length} {list.length === 1 ? "conta" : "contas"}</p>
    </Tile>
  );
  const trend = hidden ? null : <ProjectionLine points={points} area labels={false} height={size === "M" ? 48 : 80} format={money} ariaLabel="Saldo das contas no mês" />;
  if (size === "M") return (
    <Tile title="Saldo das contas" className={className} testId="accounts-insight">
      <div className="flex items-baseline justify-between gap-3"><p className={cn(NUMBER_TILE, total < 0 && "text-expense")}>{money(total)}</p></div>
      <div className="mt-0.5">{vsLine}</div>
      <div className="mt-auto">{trend}</div>
    </Tile>
  );
  const findings: Finding[] = [];
  findings.push({ tone: change >= 0 ? "good" : "bad", text: `Desde o começo do mês o saldo ${change >= 0 ? "subiu" : "caiu"} ${money(Math.abs(change))}.` });
  if (negative.length) findings.push({ tone: "bad", text: `${negative.map((a) => a.name).join(", ")} ${negative.length === 1 ? "está" : "estão"} no negativo.` });
  if (list[0] && total > 0 && list[0].balance / total > 0.8 && list.length > 1) findings.push({ tone: "info", text: `${pct(list[0].balance / total)} do dinheiro está em ${list[0].name}.` });
  const summary = [list.length === 1 ? `Você tem ${money(total)} em ${list[0].name}.` : `Você tem ${money(total)} nas ${list.length} contas.`, findings[0].text, findings[1]?.text ?? (vs ? `No fim de ${shortMonthName(prevMonth)} eram ${money(prevHistory.data!.balance)}.` : "")].filter(Boolean);
  const positive = list.filter((a) => a.balance > 0);
  const posTotal = positive.reduce((s, a) => s + a.balance, 0);
  return (
    <>{size === "XL" ? <FinnSummary title="Saldo das contas" sentences={summary} context={{ total, contas: list.map((a) => ({ nome: a.name, saldo: a.balance })), variacao_no_mes: change }} /> : null}
    <InsightShell title="Saldo das contas" subtitle={`${list.length} ${list.length === 1 ? "conta ativa" : "contas ativas"}`} to={to} className={className} testId="accounts-insight">
      <p className={LABEL}>Agora</p>
      <p className={cn(NUMBER_HERO, "mt-2", total < 0 && "text-expense")}>{hidden ? "R$ ••••" : formatBRL(total)}</p>
      <div className="mt-1">{vsLine}</div>
      <div className="mt-4">{trend}</div>
      {posTotal > 0 && positive.length > 1 && !hidden ? <SegmentedBar className="mt-4" format={money} total={posTotal} segments={positive.map((a) => ({ value: a.balance, color: a.color || FINNOS_COLOR.result, label: a.name }))} /> : null}
      <ul className="mt-4 space-y-2">
        {list.slice(0, size === "XL" ? 20 : 4).map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: a.color }} /><span className="truncate">{a.name}</span></span>
            <span className={cn("shrink-0 font-semibold tabular-nums", a.balance < 0 && "text-expense")}>{money(a.balance)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4"><FindingList findings={size === "XL" ? findings : findings.slice(0, 1)} /></div>
    </InsightShell></>
  );
}
