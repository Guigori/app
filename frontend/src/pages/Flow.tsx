import { useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, ChartColumn, ChartLine, ChevronRight, Eye, EyeOff, Wallet, X } from "lucide-react";
import { fetchAccounts, fetchCalendar, fetchCategories, fetchDashboard, fetchFlow, fetchTransactions } from "@/lib/data";
import { balanceTimeline, incomeSources, monthClose, upcoming, weeklyFlow } from "@/lib/cashFlow";
import { axisMoney } from "@/lib/analysisFormat";
import { useBalanceHidden } from "@/lib/balance";
import { addMonth, currentMonth, formatBRL, formatDate, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FlowPeriod, FlowTab, UpcomingItem, UpcomingKind } from "@/types/finnos";

const TABS: Array<{ key: FlowTab; label: string }> = [
  { key: "receitas", label: "Receitas" },
  { key: "despesas", label: "Despesas" },
  { key: "caixa", label: "Saldo" },
  { key: "projecao", label: "Projeção" },
];

const PERIODS: Array<{ key: FlowPeriod; label: string }> = [
  { key: "3", label: "3 meses" },
  { key: "6", label: "6 meses" },
  { key: "12", label: "1 ano" },
  { key: "custom", label: "Personalizado" },
];

const TAB_HINT: Record<FlowTab, string> = {
  receitas: "Tudo o que entrou em cada mês.",
  despesas: "Tudo o que saiu em cada mês.",
  caixa: "O que sobrou (entrou menos saiu) em cada mês.",
  projecao: "O que ainda é esperado: agendados, pendentes e as despesas fixas que se repetem.",
};

type ChartKind = "barras" | "linhas";

/** The Caixa tab of Fluxo. Fluxo owns the month, so both views stay on the same one. */
export default function Flow({ month: sharedMonth, onMonthChange }: { month?: string; onMonthChange?: (month: string) => void } = {}) {
  const [params] = useSearchParams();
  const initialTab = (params.get("metric") ?? "caixa") as FlowTab;
  const { hidden, toggle: toggleHidden } = useBalanceHidden();

  const [ownMonth, setOwnMonth] = useRouteState("caixa:month", () => params.get("month") ?? currentMonth());
  const month = sharedMonth ?? ownMonth;
  const setMonth = (next: string) => (onMonthChange ? onMonthChange(next) : setOwnMonth(next));
  const [tab, setTab] = useRouteState<FlowTab>("caixa:tab", () => (TABS.some((t) => t.key === initialTab) ? initialTab : "caixa"));
  const [period, setPeriod] = useRouteState<FlowPeriod>("caixa:period", "12");
  const [chartKind, setChartKind] = useRouteState<ChartKind>("caixa:chart", "barras");
  const [fromMonth, setFromMonth] = useState(addMonth(currentMonth(), -5));
  const [toMonth, setToMonth] = useState(currentMonth());
  const [categoryId, setCategoryId] = useState(params.get("category_id") || "todas");
  // Opened from a wallet account (or a lançamento's account): the whole screen follows it.
  const [accountId, setAccountId] = useState(params.get("account_id") || "todas");
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, staleTime: 60_000 });
  const accounts = accountsQuery.data ?? [];
  const account = accounts.find((a) => a.id === accountId);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 60_000 });
  const categories = categoriesQuery.data ?? [];

  const flowParams = useMemo(() => {
    const base: Record<string, string | number> = { month };
    if (period === "custom") {
      base.from_month = fromMonth;
      base.to_month = toMonth;
    } else {
      base.months = Number(period);
    }
    if (categoryId !== "todas") base.category_id = categoryId;
    if (accountId !== "todas") base.account_id = accountId;
    return base;
  }, [month, period, fromMonth, toMonth, categoryId, accountId]);

  const flowQuery = useQuery({
    queryKey: ["flow", flowParams],
    queryFn: () => fetchFlow(flowParams),
  });
  const flow = flowQuery.data;
  // Today's balance anchors the "saldo mês a mês"; the month's entries feed the lists below.
  const dashboardQuery = useQuery({ queryKey: ["dashboard", currentMonth()], queryFn: () => fetchDashboard(currentMonth()) });
  const monthTxQuery = useQuery({
    queryKey: ["transactions", "flow-month", month, accountId],
    queryFn: () => fetchTransactions(accountId === "todas" ? { month } : { month, account_id: accountId }),
  });
  const calendarQuery = useQuery({ queryKey: ["calendar", month], queryFn: () => fetchCalendar(month) });
  const isPast = month < currentMonth();
  const close = flow ? monthClose(flow) : 0;
  // With an account filter the line starts from that account's balance, not the whole wallet's.
  const anchor = accountId !== "todas" ? account?.balance : dashboardQuery.data?.total_balance;
  const timeline = flow && anchor !== undefined ? balanceTimeline(flow.series, anchor, currentMonth()) : [];
  const hasTimeline = timeline.some((p) => p.real !== null || p.forecast !== null);
  const endOfFocus = timeline.find((p) => p.month === month);
  const lowest = timeline.filter((p) => p.forecast !== null && p.month > currentMonth()).sort((a, b) => (a.forecast ?? 0) - (b.forecast ?? 0))[0];
  const sources = incomeSources(monthTxQuery.data ?? [], month);
  // The server lists every expected amount (fixed series, subscriptions, installments); older ones only send totals.
  const expected: UpcomingItem[] = flow?.upcoming ?? upcoming(monthTxQuery.data ?? [], month).map((t) => ({
    date: t.date, name: t.name, value: t.adjusted_value ?? t.value, type: t.type === "receita" ? "receita" : "despesa",
    kind: t.status === "pendente" ? "pendente" : "agendado", transaction_id: t.id, category_name: t.category_name,
  }));
  const weeks = calendarQuery.data ? weeklyFlow(month, calendarQuery.data.days) : [];
  const weekMax = Math.max(1, ...weeks.map((w) => Math.max(w.income, w.expense)));
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const chartData =
    flow?.series.map((point) => ({
      month: point.month,
      label: point.label,
      year: point.year,
      value:
        tab === "receitas"
          ? point.income
          : tab === "despesas"
            ? point.expense
            : tab === "caixa"
              ? point.net
              : point.projected_net,
      future: point.future,
    })) ?? [];

  const tone = tab === "receitas" ? "var(--income)" : tab === "despesas" ? "var(--expense)" : "var(--primary)";
  const barColor = (value: number) =>
    tab === "receitas"
      ? "var(--income)"
      : tab === "despesas"
        ? "var(--expense)"
        : value >= 0
          ? "var(--income)"
          : "var(--expense)";
  // Clicking a month on the chart focuses the summary and categories on it.
  const focusMonth = (target?: string) => {
    if (target && /^\d{4}-\d{2}$/.test(target)) setMonth(target);
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="flow-page">
      {/* Caixa is a tab of Fluxo: Fluxo's header carries the title and the way back. */}
      <header className="flex items-center justify-between gap-3">
        <p data-keep className="text-sm font-medium text-muted-foreground" data-testid="flow-subtitle">{monthLabel(month)}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleHidden}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
            aria-pressed={hidden}
            title={hidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {hidden ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
          </button>
          <MonthSelector month={month} onChange={(next) => setMonth(next)} />
        </div>
      </header>

      {accountId !== "todas" ? (
        <div className="-mt-2 flex flex-wrap items-center gap-2" data-testid="flow-account-filter">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-sm font-medium text-primary">
            <Wallet className="h-4 w-4" aria-hidden="true" />Conta: {account?.name ?? "carregando…"}
            <button type="button" onClick={() => setAccountId("todas")} className="grid size-6 place-items-center rounded-full hover:bg-primary/15" aria-label="Ver todas as contas" data-testid="flow-account-clear"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </span>
          <span className="text-xs text-muted-foreground">Transferências entre suas contas não entram nos totais.</span>
        </div>
      ) : null}

      <div>
        <div className="flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="tablist" aria-label="Tipo de fluxo">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-150",
                tab === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`flow-tab-${item.key}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 hidden text-xs text-muted-foreground sm:block" data-testid="flow-tab-hint">{TAB_HINT[tab]}</p>
      </div>

      {flowQuery.isPending ? (
        <FinnosPageLoading title="Carregando fluxo" description="Montando a entrada, saída e sobra do período." />
      ) : flowQuery.error || !flow ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="flow-error-message">
              Não foi possível carregar o fluxo. Tente novamente.
            </p>
            <Button variant="outline" onClick={() => flowQuery.refetch()} data-testid="flow-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* The answer of a cash flow first: how the month closes. Then what happened and what is still
              expected; each number selects its tab. */}
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label={`Resumo de ${monthLabel(flow.month)}`}>
            <p className="text-sm text-muted-foreground">{isPast ? (close >= 0 ? "Sobrou no mês" : "Faltou no mês") : close >= 0 ? "Deve sobrar no fim do mês" : "Deve faltar no fim do mês"}</p>
            <p className={cn("mt-1 font-heading text-3xl font-bold tabular-nums", close >= 0 ? "text-income" : "text-expense")} data-testid="flow-net-value">
              {/* The label already says sobrar/faltar; never show "faltar −R$". */}
              {money(Math.abs(close))}
            </p>
            {!isPast && (flow.projected_income || flow.projected_expense) ? (
              <p className="mt-1 text-xs text-muted-foreground">Até agora {flow.net >= 0 ? "sobrou" : "faltou"} {money(Math.abs(flow.net))}; o restante vem do que está agendado, pendente e das contas fixas.</p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-1 sm:grid-cols-4">
              {([
                { key: "receitas", label: "Entrou", value: flow.income, className: "text-income", testid: "flow-income-value", icon: ArrowDownLeft },
                { key: "despesas", label: "Saiu", value: flow.expense, className: "text-expense", testid: "flow-expense-value", icon: ArrowUpRight },
                { key: "projecao", label: "Ainda vai entrar", value: flow.projected_income, className: "text-income/80", testid: "flow-projected-income", icon: ArrowDownLeft },
                { key: "projecao", label: "Ainda vai sair", value: flow.projected_expense, className: "text-expense/80", testid: "flow-projected-value", icon: ArrowUpRight },
              ] as const).map((item) => (
                <button key={item.label} type="button" onClick={() => setTab(item.key)} aria-pressed={tab === item.key}
                  className={cn("min-w-0 rounded-xl px-3 py-2.5 text-left transition-colors", tab === item.key ? "bg-muted" : "hover:bg-muted/50")}>
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><item.icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</p>
                  <p className={cn("mt-1 whitespace-nowrap font-heading text-base font-bold tabular-nums", item.className)} data-testid={item.testid}>{money(item.value)}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Evolução por mês">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-heading text-base font-semibold text-foreground">
                  {TABS.find((t) => t.key === tab)?.label} por mês
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{monthLabel(flow.from_month)} a {monthLabel(flow.to_month)} · meses futuros mais claros</p>
              </div>
              <div className="flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="group" aria-label="Tipo de gráfico">
                {([
                  { key: "barras" as const, label: "Barras", icon: ChartColumn },
                  { key: "linhas" as const, label: "Linhas", icon: ChartLine },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setChartKind(item.key)}
                    aria-pressed={chartKind === item.key}
                    aria-label={`Gráfico de ${item.label.toLowerCase()}`}
                    title={item.label}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      chartKind === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={`flow-chart-${item.key}`}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1" role="group" aria-label="Período do fluxo">
                {PERIODS.map((item) => (
                  <Button
                    key={item.key}
                    size="sm"
                    variant={period === item.key ? "secondary" : "ghost"}
                    className="h-8 shrink-0 rounded-full px-3"
                    onClick={() => setPeriod(item.key)}
                    aria-pressed={period === item.key}
                    data-testid={`flow-period-${item.key}`}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Filtrar fluxo por categoria" data-testid="flow-category-select">
                  <SelectValue>
                    {categoryId === "todas" ? "Todas as categorias" : categories.find((c) => c.id === categoryId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as categorias</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filtrar fluxo por conta" data-testid="flow-account-select">
                  <SelectValue>{accountId === "todas" ? "Todas as contas" : account?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as contas</SelectItem>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {period === "custom" ? (
              <div className="mt-3 flex flex-wrap items-end gap-3" data-testid="flow-custom-range">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="flow-from" className="text-xs font-medium text-muted-foreground">De</label>
                  <Input id="flow-from" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value || currentMonth())} className="w-44" data-testid="flow-from-input" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="flow-to" className="text-xs font-medium text-muted-foreground">Até</label>
                  <Input id="flow-to" type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value || currentMonth())} className="w-44" data-testid="flow-to-input" />
                </div>
              </div>
            ) : null}

            <div className="mt-4 h-60 w-full" data-testid="flow-chart">
              <ResponsiveContainer width="100%" height="100%">
                {chartKind === "barras" ? (
                  <BarChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} onClick={(state) => focusMonth(chartData[Number(state?.activeTooltipIndex)]?.month)}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltipStyle} formatter={(value: number) => [hidden ? formatHiddenBRL() : formatBRL(value), TABS.find((t) => t.key === tab)?.label ?? ""]} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={30} className="cursor-pointer">
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`${entry.label}-${index}`}
                          fill={barColor(entry.value)}
                          fillOpacity={entry.month === flow.month ? 1 : entry.future && tab !== "projecao" ? 0.3 : 0.55}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} onClick={(state) => focusMonth(chartData[Number(state?.activeTooltipIndex)]?.month)}>
                    <defs>
                      <linearGradient id="flow-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={tone} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={tone} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [hidden ? formatHiddenBRL() : formatBRL(value), TABS.find((t) => t.key === tab)?.label ?? ""]} />
                    <Area type="monotone" dataKey="value" stroke={tone} strokeWidth={2} fill="url(#flow-area)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
            <p className="mt-2 hidden text-xs text-muted-foreground sm:block">Toque em um mês para ver o resumo dele.</p>
          </section>

          {hasTimeline ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Saldo mês a mês">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-heading text-base font-semibold text-foreground">Saldo em conta, mês a mês</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Fim de cada mês · estimativa, sem rendimentos</p>
                </div>
                <ul className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Legenda">
                  <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-primary" aria-hidden="true" />Real</li>
                  <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-primary" aria-hidden="true" />Previsto</li>
                </ul>
              </div>
              {endOfFocus && !isPast ? (
                <p className="mt-3 text-sm">
                  No fim de {monthLabel(month)}, o saldo deve ficar em <strong className="tabular-nums">{money(endOfFocus.forecast ?? endOfFocus.real ?? 0)}</strong>.
                  {lowest && (lowest.forecast ?? 0) < (endOfFocus.forecast ?? 0) ? <> O ponto mais baixo previsto é {monthLabel(lowest.month)}: {money(lowest.forecast ?? 0)}.</> : null}
                </p>
              ) : null}
              <div className="mt-3 h-52 w-full" data-testid="flow-balance-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <YAxis hide={hidden} width={44} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={axisMoney} />
                    <ReferenceLine y={0} stroke="var(--expense)" strokeOpacity={0.4} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [hidden ? formatHiddenBRL() : formatBRL(v), name === "real" ? "Saldo" : "Previsto"]} />
                    <Line type="monotone" dataKey="real" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--primary)" }} activeDot={{ r: 5 }} connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeWidth: 0, fill: "var(--primary)" }} activeDot={{ r: 5 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          ) : null}

          {tab === "receitas" ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="flow-income-sources">
              <div className="flex items-baseline justify-between gap-3"><h2 className="font-heading text-base font-semibold">De onde veio</h2><span className="text-xs text-muted-foreground">{monthLabel(month)}</span></div>
              {sources.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma receita recebida neste mês{flow.projected_income ? `; ${money(flow.projected_income)} ainda devem entrar` : ""}.</p> : (
                <ul className="mt-2 divide-y divide-border/70">
                  {sources.map((src) => (
                    <li key={src.key} className="flex items-center gap-3 py-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-income/10 text-income"><ArrowDownLeft className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{src.name}</span><span className="block text-xs text-muted-foreground">{src.count} {src.count === 1 ? "entrada" : "entradas"}</span></span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-income">{money(src.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "caixa" && weeks.length && accountId === "todas" ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="flow-weeks">
              <div className="flex items-baseline justify-between gap-3"><h2 className="font-heading text-base font-semibold">Semana a semana</h2><span className="text-xs text-muted-foreground">{monthLabel(month)}</span></div>
              <ul className="mt-3 space-y-3">
                {weeks.map((w) => (
                  <li key={w.label} className="grid grid-cols-[4.75rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">Dias {w.label}</span>
                    <span className="space-y-1" aria-hidden="true">
                      <span className="block h-1.5 rounded-full bg-income" style={{ width: `${(w.income / weekMax) * 100}%`, minWidth: w.income ? 4 : 0 }} />
                      <span className="block h-1.5 rounded-full bg-expense" style={{ width: `${(w.expense / weekMax) * 100}%`, minWidth: w.expense ? 4 : 0 }} />
                    </span>
                    <span className={cn("text-right font-semibold tabular-nums", w.net < 0 ? "text-expense" : w.net > 0 ? "text-income" : "text-muted-foreground")}>{w.net === 0 ? "—" : money(w.net)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-income" />Entrou</span><span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-expense" />Saiu</span></p>
            </section>
          ) : null}

          {tab === "projecao" || tab === "receitas" || tab === "despesas" ? (
            <ExpectedList
              items={expected.filter((item) => tab === "projecao" || item.type === (tab === "receitas" ? "receita" : "despesa"))}
              title={tab === "receitas" ? "Ainda vai entrar" : tab === "despesas" ? "Ainda vai sair" : "O que ainda vem"}
              month={month}
              money={money}
            />
          ) : null}

          {tab === "despesas" || tab === "caixa" ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-heading text-base font-semibold text-foreground">Onde foi o dinheiro</h2>
              <span className="text-xs text-muted-foreground">{monthLabel(flow.month)}</span>
            </div>
            {flow.categories.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="flow-categories-empty">
                Nenhum gasto categorizado neste mês.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border/70" data-testid="flow-category-list">
                {flow.categories.map((slice) => (
                  <li key={slice.category_id ?? slice.name}>
                    {/* Opens Fluxo filtered by this category and month. */}
                    <Link
                      to={`/transacoes?month=${flow.month}&metric=despesas${slice.category_id ? `&category_id=${encodeURIComponent(slice.category_id)}` : ""}`}
                      className="group flex items-center gap-3 rounded-xl px-1 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${slice.color}1A`, color: slice.color }} aria-hidden="true">
                        <CategoryIcon name={slice.icon} className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{slice.name}</p>
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(slice.total)}</p>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(slice.percent, 100)}%`, backgroundColor: slice.color }} />
                        </div>
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(slice.percent)}%</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}
        </>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

const KIND_LABEL: Record<UpcomingKind, string> = {
  agendado: "Agendado", pendente: "Pendente", parcela: "Parcela", fixa: "Fixa · todo mês", assinatura: "Assinatura",
};

/** Every amount still expected in the month, with where it comes from; they add up to the projection above. */
function ExpectedList({ items, title, month, money }: { items: UpcomingItem[]; title: string; month: string; money: (v: number) => string }) {
  const today = todayISO();
  const totals = (type: UpcomingItem["type"]) => items.filter((i) => i.type === type).reduce((sum, i) => sum + i.value, 0);
  const link = (item: UpcomingItem) =>
    item.transaction_id ? `/transacoes?date=${item.date}&highlight=${item.transaction_id}` : item.subscription_id ? "/assinaturas" : `/transacoes?month=${month}`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="flow-upcoming">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{monthLabel(month)}</span>
      </div>
      {items.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nada previsto para o resto do mês.</p> : (
        <>
          <ul className="mt-2 divide-y divide-border/70">
            {items.slice(0, 20).map((item, index) => {
              const late = item.date < today && (item.kind === "pendente" || item.kind === "agendado");
              return (
                <li key={`${item.transaction_id ?? item.subscription_id ?? item.name}-${item.date}-${index}`}>
                  <Link to={link(item)} className="flex items-center gap-3 py-2.5" data-testid="flow-upcoming-row">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", item.type === "receita" ? "bg-income/10 text-income" : "bg-expense/10 text-expense")}>{item.type === "receita" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDate(item.date)} · <span className={late ? "font-semibold text-expense" : undefined}>{late ? "Atrasado" : KIND_LABEL[item.kind]}</span>{item.category_name ? ` · ${item.category_name}` : ""}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", item.type === "receita" ? "text-income" : "text-expense")}>{item.type === "receita" ? "+" : "−"}{money(item.value)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > 20 ? <p className="mt-2 text-xs text-muted-foreground">E mais {items.length - 20}.</p> : null}
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-xs text-muted-foreground" data-testid="flow-upcoming-total">
            {totals("receita") ? <span>Entra: <strong className="text-income">{money(totals("receita"))}</strong></span> : null}
            {totals("despesa") ? <span>Sai: <strong className="text-expense">{money(totals("despesa"))}</strong></span> : null}
          </p>
        </>
      )}
    </section>
  );
}
