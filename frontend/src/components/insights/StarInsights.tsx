/** The four new analyses of the library (★): Quanto posso gastar hoje, Estimativa de saldo, Semana que vem, Fatura que vem.
 *  S and M are tiles, L is a Grande widget that fits its card, XL is the full analysis page. */
import { useQuery } from "@tanstack/react-query";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { fetchInvoice } from "@/lib/data";
import { compare, expenseUntilDay, shortMonthName } from "@/lib/insights/compare";
import { closingForMonth } from "@/lib/insights/invoices";
import { useBalanceHidden } from "@/lib/balance";
import { dailyAllowance } from "@/lib/insights/allowance";
import { balanceForecast } from "@/lib/insights/forecast";
import { daysBetween, nextInvoices, weekAhead, type NextInvoice } from "@/lib/insights/upcoming";
import { monthRange } from "@/lib/insights/fixedBills";
import type { WidgetSize } from "@/lib/insights/registry";
import type { Finding } from "@/lib/insights/invoices";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BulletBar, Gauge, ProjectionLine } from "@/components/charts/FinnosCharts";
import { BigMoney, FindingList, InsightShell, LABEL, NOTE, NUMBER_HERO, NUMBER_TILE, Tile } from "@/components/insights/InsightShell";
import { useAccounts, useBalanceHistory, useBudget, useCalendar, useCards, useOpenTransactions } from "@/components/insights/useInsightData";
import { FinnSummary, VsLastMonth } from "@/components/insights/FinnSummary";

type Props = { size: WidgetSize; to?: string; className?: string };
const dm = (date: string) => date.split("-").reverse().slice(0, 2).join("/");
const plusDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekday = (date: string) => WEEK[new Date(`${date}T12:00:00`).getDay()];
const Skeleton = ({ className }: { className?: string }) => <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
const useMoney = () => { const { hidden } = useBalanceHidden(); return { hidden, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)) }; };
const whenDue = (days: number) => (days < 0 ? `venceu há ${-days} ${days === -1 ? "dia" : "dias"}` : days === 0 ? "vence hoje" : days === 1 ? "vence amanhã" : `vence em ${days} dias`);
const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "income" | "expense" }) => (
  <div className="min-w-0"><p className={LABEL}>{label}</p><p className={cn("mt-1 truncate font-heading text-base font-semibold tabular-nums", tone === "income" && "text-income", tone === "expense" && "text-expense")}>{value}</p></div>
);

/** ★ Quanto posso gastar hoje. */
export function SpendTodayInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const today = todayISO();
  const prevMonth = addMonth(month, -1);
  const calendar = useCalendar(month);
  const prevCalendar = useCalendar(prevMonth);
  const budget = useBudget(month);
  if (!calendar.data || budget.isPending) return <Skeleton className={className} />;
  const a = dailyAllowance(calendar.data, budget.data?.planned ?? 0, today);
  const day = Number(today.slice(8, 10));
  // Spent so far against the same day of last month.
  const prevSpent = prevCalendar.data ? expenseUntilDay(prevCalendar.data.days, day) : null;
  const vs = compare(a.spent, prevSpent, "lower");
  const vsLine = <VsLastMonth c={vs} label={`no mês vs dia ${day} de ${shortMonthName(prevMonth)}`} format={money} />;
  const over = a.todayLeft < 0;
  const value = over ? money(-a.todayLeft) : money(a.todayLeft);
  const line = over ? `acima do ritmo de ${money(a.perDay)} por dia` : `ritmo de ${money(a.perDay)} por dia`;
  if (size === "S") return (
    <Tile title={over ? "Hoje passou" : "Pode gastar hoje"} className={className} testId="spend-today-insight">
      <p className={cn(NUMBER_TILE, over && "text-expense")}>{value}</p>
      <p className={cn(NOTE, "mt-auto line-clamp-2")}>{line}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title={over ? "Hoje passou do ritmo" : "Pode gastar hoje"} className={className} testId="spend-today-insight">
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className={cn(NUMBER_TILE, over && "text-expense")}>{value}</p>
          <p className={cn(NOTE, "mt-2")}>{line}</p>
          {vs ? <div className="mt-1">{vsLine}</div> : <p className={NOTE}>{a.daysLeft} {a.daysLeft === 1 ? "dia" : "dias"} até o fim do mês</p>}
        </div>
        <Gauge percent={a.used} size={104}><span className="text-sm font-semibold tabular-nums">{Math.round(a.used * 100)}%</span></Gauge>
      </div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (a.available < 0) findings.push({ tone: "bad", text: `O mês já passa ${money(-a.available)} ${a.source === "orcamento" ? "do orçamento" : "da renda"}, contando o que está agendado.` });
  else if (over) findings.push({ tone: "bad", text: `Hoje já saiu ${money(a.spentToday)}, ${money(-a.todayLeft)} acima do ritmo.` });
  else findings.push({ tone: "good", text: `Mantendo ${money(a.perDay)} por dia, o mês fecha dentro ${a.source === "orcamento" ? "do orçamento" : "da renda"}.` });
  if (a.source === "renda") findings.push({ tone: "info", text: "Sem orçamento definido: a conta usa a renda do mês." });
  const summary = [
    over ? `Hoje você já passou ${money(-a.todayLeft)} do ritmo de ${money(a.perDay)} por dia.` : `Hoje ainda dá para gastar ${money(a.todayLeft)} sem sair do ritmo de ${money(a.perDay)} por dia.`,
    vs && prevSpent != null ? `No mês já saíram ${money(a.spent)}, ${vs.same ? "o mesmo que" : vs.better ? `${money(-vs.delta)} a menos que` : `${money(vs.delta)} a mais que`} até o dia ${day} de ${shortMonthName(prevMonth)}.` : `No mês já saíram ${money(a.spent)}.`,
    a.available < 0 ? `Contando o que está agendado, o mês passa ${money(-a.available)} ${a.source === "orcamento" ? "do orçamento" : "da renda"}.` : `Sobram ${money(a.available)} para os próximos ${a.daysLeft} dias.`,
  ];
  return (
    <>{size === "XL" ? <FinnSummary title="Quanto posso gastar hoje" sentences={summary} context={{ hoje_pode: a.todayLeft, por_dia: a.perDay, ja_saiu: a.spent, agendado: a.scheduled, sobra: a.available, base: a.source }} /> : null}
    <InsightShell title="Quanto posso gastar hoje" subtitle={`${a.daysLeft} ${a.daysLeft === 1 ? "dia" : "dias"} até o fim do mês`} to={to} className={className} testId="spend-today-insight">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={LABEL}>{over ? "Hoje passou" : "Ainda hoje"}</p>
          <p className={cn(NUMBER_HERO, "mt-2", over && "text-expense")}>{hidden ? "R$ ••••" : value}</p>
          <p className={cn(NOTE, "mt-2")}>{line}</p>
          <div className="mt-1">{vsLine}</div>
        </div>
        <Gauge percent={a.used} size={120}><span className="text-sm font-semibold tabular-nums">{Math.round(a.used * 100)}%</span><span className="block text-[11px] text-muted-foreground">usado</span></Gauge>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label={a.source === "orcamento" ? "Orçamento" : "Renda"} value={money(a.base)} />
        <Stat label="Já saiu" value={money(a.spent)} tone="expense" />
        <Stat label="Agendado" value={money(a.scheduled)} />
        <Stat label="Sobra no mês" value={money(a.available)} tone={a.available < 0 ? "expense" : undefined} />
      </div>
      <div className="mt-auto pt-4"><FindingList findings={size === "L" ? findings.slice(0, 1) : findings} /></div>
    </InsightShell></>
  );
}

/** ★ Estimativa de saldo no fim do mês. */
export function BalanceForecastInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const today = todayISO();
  const prevMonth = addMonth(month, -1);
  const history = useBalanceHistory(month);
  const prevHistory = useBalanceHistory(prevMonth);
  const calendar = useCalendar(month);
  const cards = useCards();
  const accounts = useAccounts();
  const open = useOpenTransactions(today, monthRange(month).end);
  if (!history.data || !calendar.data || !cards.data || !accounts.data || !open.data) return <Skeleton className={className} />;
  const f = balanceForecast(history.data, open.data, nextInvoices(cards.data, accounts.data, today), calendar.data.planned ?? [], today);
  const endTone = f.end < 0 ? "text-expense" : "";
  // The estimated close of this month against how last month really closed.
  const vs = compare(f.end, prevHistory.data?.balance, "higher");
  const vsLine = <VsLastMonth c={vs} label={`vs fim de ${shortMonthName(prevMonth)}`} format={money} />;
  const points = f.series.map((p) => ({ value: p.value, kind: p.kind, label: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}` }));
  const change = <span className={cn("font-semibold", f.change < 0 ? "text-expense" : "text-income")}>{f.change >= 0 ? "+" : "−"}{money(Math.abs(f.change))}</span>;
  if (size === "S") return (
    <Tile title="Saldo no fim do mês" className={className} testId="forecast-insight">
      <p className={cn(NUMBER_TILE, endTone)}>{money(f.end)}</p>
      <div className="mt-auto">{vs ? vsLine : <p className={NOTE}>estimativa · {change}</p>}</div>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Estimativa de saldo" className={className} testId="forecast-insight">
      <div className="flex items-baseline justify-between gap-3"><p className={cn(NUMBER_TILE, endTone)}>{money(f.end)}</p><p className={cn(NOTE, "shrink-0")}>{change} até dia {f.series.at(-1)?.date.slice(8)}</p></div>
      <div className="mt-auto">{hidden ? null : <ProjectionLine points={points} height={56} labels={false} ariaLabel="Saldo real e estimativa do mês" />}</div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (f.firstNegative) findings.push({ tone: "bad", text: `O saldo fica negativo em ${dm(f.firstNegative)}${f.lowest ? ` e chega a ${money(f.lowest.value)} em ${dm(f.lowest.date)}` : ""}.` });
  else if (f.lowest && f.lowest.value < f.today) findings.push({ tone: "info", text: `O dia mais apertado é ${dm(f.lowest.date)}, com ${money(f.lowest.value)}.` });
  findings.push(f.change >= 0 ? { tone: "good", text: `O mês deve fechar com ${money(f.change)} a mais do que hoje.` } : { tone: "bad", text: `Até o fim do mês saem ${money(-f.change)} a mais do que entram.` });
  const summary = [
    `A estimativa é fechar o mês com ${money(f.end)} nas contas, ${f.change >= 0 ? `${money(f.change)} a mais` : `${money(-f.change)} a menos`} do que hoje.`,
    f.firstNegative ? `Atenção: o saldo fica negativo em ${dm(f.firstNegative)}${f.lowest ? ` e chega a ${money(f.lowest.value)}` : ""}.` : f.lowest && f.lowest.value < f.today ? `O dia mais apertado é ${dm(f.lowest.date)}, com ${money(f.lowest.value)}.` : "Não há dia em que o saldo fique abaixo do de hoje.",
    ...(vs && prevHistory.data ? [`${shortMonthName(prevMonth).replace(/^./, (c) => c.toUpperCase())} fechou com ${money(prevHistory.data.balance)}; este mês deve fechar ${vs.same ? "igual" : vs.better ? `${money(vs.delta)} acima` : `${money(-vs.delta)} abaixo`}.`] : []),
  ];
  return (
    <>{size === "XL" ? <FinnSummary title="Estimativa de saldo" sentences={summary} context={{ hoje: f.today, fim_do_mes: f.end, entra: f.incoming, sai: f.outgoing, negativo_em: f.firstNegative, mes_passado: prevHistory.data?.balance }} /> : null}
    <InsightShell title="Estimativa de saldo" subtitle="Real até hoje, estimativa até o fim do mês" to={to} className={className} testId="forecast-insight">
      <p className={LABEL}>Fim do mês</p>
      <BigMoney value={f.end} hidden={hidden} className={cn("mt-2", endTone)} />
      <p className={cn(NOTE, "mt-2")}>hoje {money(f.today)} · {change}</p>
      <div className="mt-1">{vsLine}</div>
      {hidden ? null : <div className="mt-4"><ProjectionLine points={points} height={size === "XL" ? 132 : 92} ariaLabel="Saldo real e estimativa do mês" format={money} /></div>}
      <div className="mt-4 grid grid-cols-2 gap-4"><Stat label="Ainda entra" value={money(f.incoming)} tone="income" /><Stat label="Ainda sai" value={money(f.outgoing)} tone="expense" /></div>
      {size === "XL" ? (
        <>
          <div className="mt-5"><FindingList findings={findings} /></div>
          <p className={cn(LABEL, "mt-6")}>O que ainda acontece no mês</p>
          {f.events.length ? (
            <ul className="mt-2 divide-y divide-border/70 text-sm">
              {f.events.map((e, i) => <li key={e.date + e.name + i} className="flex items-center justify-between gap-3 py-2.5"><span className="min-w-0 truncate"><span className="text-muted-foreground">{dm(e.date)} · </span>{e.name}</span><span className={cn("shrink-0 font-semibold tabular-nums", e.value < 0 ? "text-expense" : "text-income")}>{e.value < 0 ? "−" : "+"}{money(Math.abs(e.value))}</span></li>)}
            </ul>
          ) : <p className={cn(NOTE, "mt-2")}>Nada agendado até o fim do mês.</p>}
        </>
      ) : <div className="mt-auto pt-4"><FindingList findings={findings.slice(0, 1)} /></div>}
    </InsightShell></>
  );
}

/** ★ Semana que vem: contas, faturas e assinaturas dos próximos 7 dias. */
export function WeekAheadInsight({ size, to, className }: Props) {
  const { money } = useMoney();
  const dialogs = useDialogs();
  const today = todayISO();
  const month = currentMonth();
  const end = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
  const crosses = end.slice(0, 7) !== month;
  const calendar = useCalendar(month);
  const nextCalendar = useCalendar(crosses ? addMonth(month, 1) : month);
  const cards = useCards();
  const accounts = useAccounts();
  const open = useOpenTransactions(today, end);
  const past = useOpenTransactions(plusDays(today, -7), plusDays(today, -1));
  if (!calendar.data || !nextCalendar.data || !cards.data || !accounts.data || !open.data) return <Skeleton className={className} />;
  const planned = [...(calendar.data.planned ?? []), ...(crosses ? nextCalendar.data.planned ?? [] : [])];
  const w = weekAhead(open.data, nextInvoices(cards.data, accounts.data, today), planned, today, 7);
  const label = (date: string) => (date === today ? "hoje" : daysBetween(today, date) === 1 ? "amanhã" : `${weekday(date)} ${dm(date)}`);
  const outs = w.items.filter((i) => i.kind !== "entrada");
  // What left the bank in the 7 days before (card purchases are paid in the invoice, so they stay out).
  const lastWeek = past.data ? past.data.filter((t) => t.type === "despesa" && t.status === "pago" && !t.card_id).reduce((sum, t) => sum + (t.adjusted_value ?? t.value), 0) : null;
  const vs = compare(w.out, lastWeek, "lower");
  const vsLine = <VsLastMonth c={vs} label="vs últimos 7 dias" format={money} />;
  const row = (i: (typeof outs)[number]) => <li key={i.id} className="flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate"><span className="text-muted-foreground">{label(i.date)} · </span>{i.name}</span><span className="shrink-0 tabular-nums">{money(i.value)}</span></li>;
  if (size === "S") return (
    <Tile title="Próximos 7 dias" className={className} testId="week-insight">
      <p className={NUMBER_TILE}>{money(w.out)}</p>
      <p className={cn(NOTE, "mt-auto line-clamp-2")}>{outs.length} a pagar{w.heaviest ? ` · mais pesado ${label(w.heaviest.date)}` : ""}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Semana que vem" className={className} testId="week-insight">
      <div className="flex items-baseline justify-between gap-3"><p className={NUMBER_TILE}>{money(w.out)}</p>{w.income > 0 ? <span className="shrink-0 text-[13px] font-semibold text-income">entra {money(w.income)}</span> : null}</div>
      {vsLine}
      <ul className="mt-auto space-y-1">{outs.slice(0, 2).map(row)}{!outs.length ? <li className={NOTE}>Nada a pagar nos próximos 7 dias.</li> : null}</ul>
    </Tile>
  );
  const days = size === "XL" ? w.days : w.days.slice(0, 3);
  const biggest = [...outs].sort((x, y) => y.value - x.value)[0];
  const summary = [
    outs.length ? `Nos próximos 7 dias saem ${money(w.out)} em ${outs.length} ${outs.length === 1 ? "compromisso" : "compromissos"}${w.heaviest ? `; o dia mais pesado é ${label(w.heaviest.date)}, com ${money(w.heaviest.total)}` : ""}.` : "Nada a pagar nos próximos 7 dias.",
    ...(biggest ? [`O maior é ${biggest.name}, de ${money(biggest.value)}.`] : []),
    w.income > 0 ? `Entram ${money(w.income)} no mesmo período.` : vs && lastWeek != null ? `Nos últimos 7 dias saíram ${money(lastWeek)} das contas.` : "",
  ].filter(Boolean);
  return (
    <>{size === "XL" ? <FinnSummary title="Semana que vem" sentences={summary} context={{ a_pagar: w.out, entra: w.income, itens: outs.map((i) => ({ nome: i.name, valor: i.value, dia: i.date })) }} /> : null}
    <InsightShell title="Semana que vem" subtitle={`${outs.length} a pagar nos próximos 7 dias`} to={to} className={className} testId="week-insight">
      <div className="flex items-end justify-between gap-4">
        <div><p className={LABEL}>A pagar</p><BigMoney value={w.out} hidden={false} className="mt-2" /><div className="mt-1">{vsLine}</div></div>
        {w.income > 0 ? <Stat label="Entra" value={money(w.income)} tone="income" /> : null}
      </div>
      {w.days.length === 0 ? <p className={cn(NOTE, "mt-4")}>Nada agendado nos próximos 7 dias.</p> : (
        <div className="mt-4 min-h-0 space-y-3 overflow-hidden">
          {days.map((d) => (
            <div key={d.date}>
              <p className={LABEL}>{label(d.date)}</p>
              <ul className="mt-1 divide-y divide-border/70">
                {(size === "XL" ? d.items : d.items.slice(0, 2)).map((i) => (
                  <li key={i.id}>
                    <button type="button" disabled={!i.tx} onClick={() => i.tx && dialogs.openTransactionDetail(i.tx, w.items.flatMap((x) => (x.tx ? [x.tx] : [])))} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm disabled:cursor-default">
                      <span className="min-w-0"><span className="block truncate font-medium">{i.name}</span><span className="block text-[12px] text-muted-foreground">{i.kind === "fatura" ? "Fatura do cartão" : i.kind === "assinatura" ? "Assinatura" : i.kind === "entrada" ? "Entrada" : "Conta"}{i.where ? ` · ${i.where}` : ""}</span></span>
                      <span className={cn("shrink-0 font-semibold tabular-nums", i.kind === "entrada" && "text-income")}>{i.kind === "entrada" ? "+" : ""}{money(i.value)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </InsightShell></>
  );
}

/** ★ Fatura que vem: the next invoice to pay and whether the paying account covers it. */
export function NextInvoiceInsight({ size, to, className }: Props) {
  const { money } = useMoney();
  const today = todayISO();
  const cards = useCards();
  const accounts = useAccounts();
  const list = cards.data && accounts.data ? nextInvoices(cards.data, accounts.data, today) : [];
  const first = list[0];
  // The same card's previous invoice, to say if this one came bigger.
  const firstCard = cards.data?.find((c) => c.id === first?.cardId);
  const prevCycle = firstCard && first ? closingForMonth(firstCard, addMonth((first.closed ? firstCard.payable_cycle ?? firstCard.next_closing : firstCard.next_closing).slice(0, 7), -1)) : null;
  const prevInvoice = useQuery({ queryKey: ["invoice", firstCard?.id, prevCycle], queryFn: () => fetchInvoice(firstCard!.id, prevCycle!), enabled: Boolean(firstCard && prevCycle), staleTime: 60_000 });
  if (!cards.data || !accounts.data) return <Skeleton className={className} />;
  const vs = first ? compare(first.amount, prevInvoice.data?.total, "lower") : null;
  const vsLine = <VsLastMonth c={vs} label="vs fatura anterior" format={money} />;
  if (!first) return (
    <Tile title="Fatura que vem" className={className} testId="next-invoice-insight">
      <p className={NUMBER_TILE}>Tudo pago</p><p className={cn(NOTE, "mt-auto")}>Nenhuma fatura em aberto.</p>
    </Tile>
  );
  const cover = (i: NextInvoice) => i.covers == null ? "sem conta de pagamento definida" : i.covers ? `${i.accountName} cobre` : `faltam ${money(i.shortfall)} em ${i.accountName}`;
  const alert = (i: NextInvoice) => i.days < 0 || i.covers === false;
  if (size === "S") return (
    <Tile title={`Fatura ${first.cardName}`} className={className} testId="next-invoice-insight">
      <p className={NUMBER_TILE}>{money(first.amount)}</p>
      <p className={cn(NOTE, "mt-auto", alert(first) && "font-semibold text-expense")}>{whenDue(first.days)}</p>
    </Tile>
  );
  const row = (i: NextInvoice) => (
    <div key={i.cardId}>
      <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium"><span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: i.color }} />{i.cardName}</span><span className="shrink-0 font-heading text-base font-semibold tabular-nums">{money(i.amount)}</span></div>
      {i.balanceBefore != null ? <BulletBar className="mt-2.5" value={i.amount} limit={Math.max(0, i.balanceBefore)} /> : null}
      <p className={cn(NOTE, "mt-2", alert(i) && "font-semibold text-expense")}>{whenDue(i.days)} · {dm(i.due)} · {cover(i)}</p>
    </div>
  );
  if (size === "M") return (
    <Tile title="Fatura que vem" className={className} testId="next-invoice-insight">
      {row(first)}
      <div className="mt-1">{vsLine}</div>
      {list.length > 1 ? <p className={cn(NOTE, "mt-auto")}>+ {list.length - 1} {list.length === 2 ? "fatura" : "faturas"} depois · {money(list.slice(1).reduce((s, i) => s + i.amount, 0))}</p> : null}
    </Tile>
  );
  const short = list.filter((i) => i.covers === false);
  const summary = [
    `A próxima fatura é a do ${first.cardName}: ${money(first.amount)}, ${whenDue(first.days)} (${dm(first.due)}).`,
    short.length ? `${short.map((i) => `${i.accountName} não cobre a do ${i.cardName}: faltam ${money(i.shortfall)}`).join("; ")}.` : first.covers ? `O saldo de ${first.accountName} cobre${list.length > 1 ? " todas as faturas em aberto" : ""}.` : "",
    vs && prevInvoice.data ? `A fatura anterior do ${first.cardName} foi de ${money(prevInvoice.data.total)}; esta veio ${vs.same ? "igual" : vs.better ? `${money(-vs.delta)} menor` : `${money(vs.delta)} maior`}.` : "",
  ].filter(Boolean);
  return (
    <>{size === "XL" ? <FinnSummary title="Fatura que vem" sentences={summary} context={{ faturas: list.map((i) => ({ cartao: i.cardName, valor: i.amount, vence: i.due, conta: i.accountName, cobre: i.covers, falta: i.shortfall })) }} /> : null}
    <InsightShell title="Fatura que vem" subtitle="A marca é o saldo da conta que paga" to={to} className={className} testId="next-invoice-insight">
      {vsLine}
      <div className="mt-3 space-y-5">{(size === "XL" ? list : list.slice(0, 3)).map(row)}</div>
      {size !== "XL" && list.length > 3 ? <p className={cn(NOTE, "mt-auto pt-3")}>+ {list.length - 3} cartões</p> : null}
    </InsightShell></>
  );
}
