/** The four new analyses of the library (★): Quanto posso gastar hoje, Previsão de saldo, Semana que vem, Fatura que vem. */
import { Link } from "react-router-dom";
import { CalendarClock, CreditCard as CardIcon, LineChart, Wallet } from "lucide-react";
import { addMonth, currentMonth, formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { dailyAllowance } from "@/lib/insights/allowance";
import { balanceForecast } from "@/lib/insights/forecast";
import { daysBetween, nextInvoices, weekAhead } from "@/lib/insights/upcoming";
import { monthRange } from "@/lib/insights/fixedBills";
import type { WidgetSize } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BulletBar, FINNOS_COLOR, Gauge, ProjectionLine } from "@/components/charts/FinnosCharts";
import { BigMoney, FindingList, InsightShell, Tile } from "@/components/insights/InsightShell";
import { useAccounts, useBalanceHistory, useBudget, useCalendar, useCards, useOpenTransactions } from "@/components/insights/useInsightData";
import type { Finding } from "@/lib/insights/invoices";

type Props = { size: WidgetSize; to?: string; className?: string };
const dm = (date: string) => date.split("-").reverse().slice(0, 2).join("/");
const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekday = (date: string) => WEEK[new Date(`${date}T12:00:00`).getDay()];
const Skeleton = ({ size, className }: { size: WidgetSize; className?: string }) => <div className={cn("h-full animate-pulse rounded-[24px] bg-muted", size === "L" || size === "XL" ? "min-h-[22rem]" : "", className)} />;
const useMoney = () => { const { hidden } = useBalanceHidden(); return { hidden, money: (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v)) }; };
const whenDue = (days: number) => (days < 0 ? `venceu há ${-days} ${days === -1 ? "dia" : "dias"}` : days === 0 ? "vence hoje" : days === 1 ? "vence amanhã" : `vence em ${days} dias`);

/** ★ Quanto posso gastar hoje. */
export function SpendTodayInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const today = todayISO();
  const calendar = useCalendar(month);
  const budget = useBudget(month);
  if (!calendar.data || budget.isPending) return <Skeleton size={size} className={className} />;
  const a = dailyAllowance(calendar.data, budget.data?.planned ?? 0, today);
  const over = a.todayLeft < 0;
  const big = <p className={cn("font-heading font-bold tabular-nums leading-none", size === "S" ? "text-[clamp(1.15rem,6vw,1.625rem)]" : "text-[30px]", over ? "text-expense" : "text-foreground")}>{money(Math.abs(a.todayLeft))}</p>;
  const line = over ? `Hoje passou ${money(-a.todayLeft)} do ritmo` : `${money(a.perDay)}/dia até o fim do mês`;
  if (size === "S") return (
    <Tile title="Pode gastar hoje" icon={<Wallet className="size-3.5" />} className={className} testId="spend-today-insight">
      {big}<p className="mt-auto text-xs text-muted-foreground">{line}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Quanto posso gastar hoje" icon={<Wallet className="size-3.5" />} className={className} testId="spend-today-insight">
      <div className="flex flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">{big}<p className="mt-2 text-xs text-muted-foreground">{line}</p><p className="text-xs text-muted-foreground">{a.daysLeft} {a.daysLeft === 1 ? "dia" : "dias"} · sobra {money(Math.max(0, a.available))} no mês</p></div>
        <Gauge percent={a.used} size={112}><span className="text-sm font-bold tabular-nums">{Math.round(a.used * 100)}%</span></Gauge>
      </div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (a.available < 0) findings.push({ tone: "bad", text: `O mês já está ${money(-a.available)} além ${a.source === "orcamento" ? "do orçamento" : "da renda"}, contando o que está agendado.` });
  else if (over) findings.push({ tone: "bad", text: `Hoje já saiu ${money(a.spentToday)}, ${money(-a.todayLeft)} acima do ritmo do mês.` });
  else findings.push({ tone: "good", text: `No ritmo de ${money(a.perDay)} por dia, o mês fecha dentro ${a.source === "orcamento" ? "do orçamento" : "da renda"}.` });
  if (a.source === "renda") findings.push({ tone: "info", text: "Sem orçamento definido: a conta usa a renda do mês." });
  return (
    <InsightShell title="Quanto posso gastar hoje" subtitle={`${a.daysLeft} ${a.daysLeft === 1 ? "dia" : "dias"} até o fim do mês`} icon={<Wallet className="size-5" />} to={to} className={className} testId="spend-today-insight">
      <Gauge percent={a.used} size={200}>
        <p className={cn("font-heading text-[28px] font-bold tabular-nums leading-none", over && "text-expense")}>{hidden ? "R$ ••••" : formatBRL(Math.abs(a.todayLeft))}</p>
        <p className="mt-1 text-xs text-muted-foreground">{over ? "acima do ritmo hoje" : "ainda hoje"}</p>
      </Gauge>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">{a.source === "orcamento" ? "Orçamento do mês" : "Renda do mês"}</dt><dd className="font-semibold tabular-nums">{money(a.base)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Já saiu</dt><dd className="font-semibold tabular-nums text-expense">{money(a.spent)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Agendado até o fim</dt><dd className="font-semibold tabular-nums" style={{ color: FINNOS_COLOR.forecast }}>{money(a.scheduled)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Sobra no mês</dt><dd className={cn("font-semibold tabular-nums", a.available < 0 && "text-expense")}>{money(a.available)}</dd></div>
      </dl>
      <div className="mt-4"><FindingList findings={findings} /></div>
    </InsightShell>
  );
}

/** ★ Previsão de saldo no fim do mês. */
export function BalanceForecastInsight({ size, to, className }: Props) {
  const { hidden, money } = useMoney();
  const month = currentMonth();
  const today = todayISO();
  const history = useBalanceHistory(month);
  const calendar = useCalendar(month);
  const cards = useCards();
  const accounts = useAccounts();
  const open = useOpenTransactions(today, monthRange(month).end);
  if (!history.data || !calendar.data || !cards.data || !accounts.data || !open.data) return <Skeleton size={size} className={className} />;
  const f = balanceForecast(history.data, open.data, nextInvoices(cards.data, accounts.data, today), calendar.data.planned ?? [], today);
  const endColor = f.end < 0 ? "text-expense" : "text-foreground";
  const points = f.series.map((p) => ({ value: p.value, kind: p.kind }));
  if (size === "S") return (
    <Tile title="Saldo no fim do mês" icon={<LineChart className="size-3.5" />} className={className} testId="forecast-insight">
      <p className={cn("font-heading text-[clamp(1.15rem,6vw,1.625rem)] font-bold tabular-nums leading-none", endColor)}>{money(f.end)}</p>
      <p className="mt-auto text-xs text-muted-foreground">hoje {money(f.today)}{f.firstNegative ? ` · negativo em ${dm(f.firstNegative)}` : ""}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title="Previsão de saldo" icon={<LineChart className="size-3.5" />} className={className} testId="forecast-insight">
      <div className="flex items-baseline justify-between gap-2"><p className={cn("font-heading text-[24px] font-bold tabular-nums leading-none", endColor)}>{money(f.end)}</p><span className={cn("text-xs font-semibold", f.change < 0 ? "text-expense" : "text-income")}>{f.change >= 0 ? "+" : "−"}{money(Math.abs(f.change))} até dia {f.series.at(-1)?.date.slice(8)}</span></div>
      <div className="mt-auto">{hidden ? null : <ProjectionLine points={points} height={64} labels={false} ariaLabel="Saldo real e previsto do mês" />}</div>
    </Tile>
  );
  const findings: Finding[] = [];
  if (f.firstNegative) findings.push({ tone: "bad", text: `O saldo fica negativo em ${dm(f.firstNegative)}${f.lowest ? ` e chega a ${money(f.lowest.value)} em ${dm(f.lowest.date)}` : ""}.` });
  else if (f.lowest && f.lowest.value < f.today) findings.push({ tone: "info", text: `O dia mais apertado é ${dm(f.lowest.date)}, com ${money(f.lowest.value)}.` });
  findings.push(f.change >= 0 ? { tone: "good", text: `O mês deve fechar com ${money(f.change)} a mais do que hoje.` } : { tone: "bad", text: `Até o fim do mês saem ${money(-f.change)} a mais do que entram.` });
  const events = size === "XL" ? f.events : f.events.slice(0, 4);
  return (
    <InsightShell title="Previsão de saldo" subtitle="Saldo das contas: real até hoje, previsto até o fim do mês" icon={<LineChart className="size-5" />} to={to} className={className} testId="forecast-insight">
      <BigMoney value={f.end} hidden={hidden} className={endColor} />
      <p className="mt-1 text-xs text-muted-foreground">no fim do mês · hoje {money(f.today)}</p>
      {hidden ? null : <div className="mt-3"><ProjectionLine points={points} height={112} ariaLabel="Saldo real e previsto do mês" /></div>}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Ainda entra</p><p className="font-semibold tabular-nums text-income">{money(f.incoming)}</p></div>
        <div><p className="text-xs text-muted-foreground">Ainda sai</p><p className="font-semibold tabular-nums text-expense">{money(f.outgoing)}</p></div>
      </div>
      <div className="mt-3"><FindingList findings={findings} /></div>
      {events.length ? (
        <ul className="mt-3 divide-y divide-border/70 text-sm">
          {events.map((e, i) => <li key={e.date + e.name + i} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate"><span className="text-xs text-muted-foreground">{dm(e.date)} · </span>{e.name}</span><span className={cn("shrink-0 font-semibold tabular-nums", e.value < 0 ? "text-expense" : "text-income")}>{e.value < 0 ? "−" : "+"}{money(Math.abs(e.value))}</span></li>)}
        </ul>
      ) : <p className="mt-3 text-sm text-muted-foreground">Nada agendado até o fim do mês.</p>}
    </InsightShell>
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
  if (!calendar.data || !nextCalendar.data || !cards.data || !accounts.data || !open.data) return <Skeleton size={size} className={className} />;
  const planned = [...(calendar.data.planned ?? []), ...(crosses ? nextCalendar.data.planned ?? [] : [])];
  const w = weekAhead(open.data, nextInvoices(cards.data, accounts.data, today), planned, today, 7);
  const label = (date: string) => (date === today ? "hoje" : daysBetween(today, date) === 1 ? "amanhã" : `${weekday(date)} ${dm(date)}`);
  if (size === "S") return (
    <Tile title="Próximos 7 dias" icon={<CalendarClock className="size-3.5" />} className={className} testId="week-insight">
      <p className="font-heading text-[clamp(1.15rem,6vw,1.625rem)] font-bold tabular-nums leading-none">{money(w.out)}</p>
      <p className="mt-auto text-xs text-muted-foreground">{w.items.filter((i) => i.kind !== "entrada").length} a pagar{w.heaviest ? ` · mais pesado ${label(w.heaviest.date)}` : ""}</p>
    </Tile>
  );
  const outs = w.items.filter((i) => i.kind !== "entrada");
  if (size === "M") return (
    <Tile title="Semana que vem" icon={<CalendarClock className="size-3.5" />} className={className} testId="week-insight">
      <div className="flex items-baseline justify-between gap-2"><p className="font-heading text-[22px] font-bold tabular-nums leading-none">{money(w.out)}</p>{w.income > 0 ? <span className="text-xs font-semibold text-income">+{money(w.income)} entra</span> : null}</div>
      <ul className="mt-2 space-y-1 text-xs">
        {outs.slice(0, 3).map((i) => <li key={i.id} className="flex justify-between gap-2"><span className="min-w-0 truncate"><span className="text-muted-foreground">{label(i.date)} · </span>{i.name}</span><span className="shrink-0 tabular-nums">{money(i.value)}</span></li>)}
        {!outs.length ? <li className="text-muted-foreground">Nada a pagar nos próximos 7 dias.</li> : null}
      </ul>
    </Tile>
  );
  return (
    <InsightShell title="Semana que vem" subtitle={`${outs.length} a pagar nos próximos 7 dias${w.income > 0 ? ` · entra ${money(w.income)}` : ""}`} icon={<CalendarClock className="size-5" />} to={to} className={className} testId="week-insight">
      <BigMoney value={w.out} hidden={false} />
      {w.heaviest ? <p className="mt-1 text-xs text-muted-foreground">Dia mais pesado: <b className="text-foreground">{label(w.heaviest.date)}</b>, {money(w.heaviest.total)}</p> : null}
      {w.days.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nada agendado nos próximos 7 dias.</p> : (
        <div className="mt-3 space-y-3">
          {w.days.map((d) => (
            <div key={d.date}>
              <p className="text-xs font-semibold uppercase tracking-[1px] text-muted-foreground">{label(d.date)}</p>
              <ul className="mt-1 divide-y divide-border/70">
                {d.items.map((i) => (
                  <li key={i.id}>
                    <button type="button" disabled={!i.tx} onClick={() => i.tx && dialogs.openTransactionDetail(i.tx, w.items.flatMap((x) => (x.tx ? [x.tx] : [])))} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm disabled:cursor-default">
                      <span className="min-w-0"><span className="block truncate font-medium">{i.name}</span><span className="block text-xs text-muted-foreground">{i.kind === "fatura" ? "Fatura do cartão" : i.kind === "assinatura" ? "Assinatura" : i.kind === "entrada" ? "Entrada" : "Conta"}{i.where ? ` · ${i.where}` : ""}</span></span>
                      <span className={cn("shrink-0 font-semibold tabular-nums", i.kind === "entrada" && "text-income")}>{i.kind === "entrada" ? "+" : ""}{money(i.value)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </InsightShell>
  );
}

/** ★ Fatura que vem: the next invoice to pay and whether the paying account covers it. */
export function NextInvoiceInsight({ size, to, className }: Props) {
  const { money } = useMoney();
  const today = todayISO();
  const cards = useCards();
  const accounts = useAccounts();
  if (!cards.data || !accounts.data) return <Skeleton size={size} className={className} />;
  const list = nextInvoices(cards.data, accounts.data, today);
  const first = list[0];
  if (!first) return (
    <Tile title="Fatura que vem" icon={<CardIcon className="size-3.5" />} className={className} testId="next-invoice-insight">
      <p className="font-heading text-xl font-bold">Tudo pago</p><p className="mt-auto text-xs text-muted-foreground">Nenhuma fatura em aberto.</p>
    </Tile>
  );
  const cover = (i: typeof first) => i.covers == null ? "sem conta de pagamento definida" : i.covers ? `${i.accountName} cobre` : `faltam ${money(i.shortfall)} em ${i.accountName}`;
  if (size === "S") return (
    <Tile title={`Fatura ${first.cardName}`} icon={<CardIcon className="size-3.5" />} className={className} testId="next-invoice-insight">
      <p className="font-heading text-[clamp(1.15rem,6vw,1.625rem)] font-bold tabular-nums leading-none">{money(first.amount)}</p>
      <p className={cn("mt-auto text-xs", first.days < 0 || first.covers === false ? "font-semibold text-expense" : "text-muted-foreground")}>{whenDue(first.days)}</p>
    </Tile>
  );
  const row = (i: typeof first) => (
    <div key={i.cardId}>
      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate"><span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: i.color }} />{i.cardName} · <span className={i.days < 0 ? "text-expense" : "text-muted-foreground"}>{whenDue(i.days)} ({dm(i.due)})</span></span><span className="shrink-0 font-semibold tabular-nums">{money(i.amount)}</span></div>
      {i.balanceBefore != null ? <BulletBar className="mt-2" value={i.amount} limit={Math.max(0, i.balanceBefore)} /> : null}
      <p className={cn("mt-1.5 text-xs", i.covers === false ? "font-semibold text-expense" : "text-muted-foreground")}>{cover(i)}{i.closed ? "" : " · fatura ainda aberta"}</p>
    </div>
  );
  if (size === "M") return (
    <Tile title="Fatura que vem" icon={<CardIcon className="size-3.5" />} className={className} testId="next-invoice-insight">
      <div className="mt-1">{row(first)}</div>
      {list.length > 1 ? <p className="mt-auto text-xs text-muted-foreground">+ {list.length - 1} {list.length === 2 ? "fatura" : "faturas"} depois · {money(list.slice(1).reduce((s, i) => s + i.amount, 0))}</p> : null}
    </Tile>
  );
  return (
    <InsightShell title="Fatura que vem" subtitle="A marca é o saldo da conta que paga; passar dela é faltar dinheiro" icon={<CardIcon className="size-5" />} to={to} className={className} testId="next-invoice-insight">
      <div className="space-y-5">{list.map(row)}</div>
      <Link to="/contas?aba=cartoes" className="mt-4 inline-block text-sm font-semibold text-primary">Ver cartões</Link>
    </InsightShell>
  );
}
