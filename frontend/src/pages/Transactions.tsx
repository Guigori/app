import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, BellOff, CalendarDays, ChartPie, Filter, List, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteTransaction, fetchAccounts, fetchCalendar, fetchCategories, fetchTransactions } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { useBalanceHidden } from "@/lib/balance";
import {
  currentMonth,
  formatBRL,
  todayISO,
  formatDate,
  formatHiddenBRL,
  formatSignedBRL,
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
  monthLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { setSelectedDay } from "@/lib/selectedDay";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { TransactionCalendar } from "@/components/transactions/TransactionCalendar";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { StatusBadge } from "@/components/shared/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Account, Category, Transaction, TxStatus, TxType } from "@/types/finnos";

function signedValue(t: Transaction): number {
  return t.type === "receita" ? t.value : -t.value;
}

export default function Transactions() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const linkedDate = searchParams.get("date");
  const linkedMonth = searchParams.get("month");
  const linkedMetric = searchParams.get("metric");
  const linkedCategoryId = searchParams.get("category_id");
  const highlightedTransactionId = searchParams.get("highlight");
  const { hidden } = useBalanceHidden();

  const [month, setMonth] = useState(currentMonth());
  const [periodMode, setPeriodMode] = useState<"rolling30" | "month">("rolling30");
  const [flowView, setFlowView] = useState<"calendario" | "categorias" | "lista">("calendario");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [scope, setScope] = useState<"dia" | "mes">("mes");
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"todos" | TxType>("todos");
  const [status, setStatus] = useState<"todos" | TxStatus>("todos");
  const [categoryId, setCategoryId] = useState("todas");
  const [selectedDonutCategory, setSelectedDonutCategory] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("todas");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!linkedDate || !/^\d{4}-\d{2}-\d{2}$/.test(linkedDate)) return;
    setPeriodMode("month");
    setMonth(linkedDate.slice(0, 7));
    setSelectedDate(linkedDate);
    setScope("dia");
    setFlowView("calendario");
  }, [linkedDate]);

  useEffect(() => {
    if (linkedDate) return;
    if (linkedMonth && /^\d{4}-\d{2}$/.test(linkedMonth)) {
      setPeriodMode("month");
      setMonth(linkedMonth);
      setSelectedDate(todayISO().slice(0, 7) === linkedMonth ? todayISO() : `${linkedMonth}-01`);
      setScope("mes");
    }
    if (linkedCategoryId) {
      setCategoryId(linkedCategoryId);
      setSelectedDonutCategory(linkedCategoryId);
      setType("despesa");
      setFlowView("categorias");
    } else if (linkedMetric === "despesas") {
      setType("despesa");
      setFlowView("categorias");
    } else if (linkedMetric === "receitas") {
      setType("receita");
      setFlowView("lista");
    } else if (linkedMetric === "caixa") {
      setType("todos");
      setFlowView("lista");
    }
  }, [linkedCategoryId, linkedDate, linkedMetric, linkedMonth]);


  // The global "+" reads this, so a new entry lands on the day being viewed.
  useEffect(() => {
    setSelectedDay(scope === "dia" ? selectedDate : null);
    return () => setSelectedDay(null);
  }, [scope, selectedDate]);

  const pickDate = (date: string) => {
    if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
    setSelectedDate(date);
    setScope("dia");
  };

  const changeMonth = (next: string) => {
    setPeriodMode("month");
    setScope("mes");
    setMonth(next);
    // Keep the selection inside the visible month: today when it belongs there, day 1 otherwise.
    setSelectedDate(todayISO().slice(0, 7) === next ? todayISO() : `${next}-01`);
  };

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const calendarQuery = useQuery({ queryKey: ["calendar", month], queryFn: () => fetchCalendar(month) });
  const calendar = calendarQuery.data;
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const rollingRange = useMemo(() => {
    const end = todayISO();
    const endDate = new Date(`${end}T12:00:00`);
    endDate.setDate(endDate.getDate() - 29);
    const start = [
      endDate.getFullYear(),
      String(endDate.getMonth() + 1).padStart(2, "0"),
      String(endDate.getDate()).padStart(2, "0"),
    ].join("-");
    return { start, end };
  }, []);

  const filters = useMemo(() => {
    const f: Record<string, string> =
      scope === "dia"
        ? { start_date: selectedDate, end_date: selectedDate }
        : periodMode === "rolling30"
          ? { start_date: rollingRange.start, end_date: rollingRange.end }
          : { month };
    if (deferredSearch.trim()) f.search = deferredSearch.trim();
    if (type !== "todos") f.type = type;
    if (status !== "todos") f.status = status;
    if (categoryId !== "todas") f.category_id = categoryId;
    if (accountId !== "todas") f.account_id = accountId;
    return f;
  }, [month, periodMode, rollingRange, scope, selectedDate, deferredSearch, type, status, categoryId, accountId]);

  const transactionsQuery = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => fetchTransactions(filters),
  });
  const monthTransactions = transactionsQuery.data ?? [];
  const transactions = monthTransactions
    .slice()
    .sort((a, b) => (sortDir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  useEffect(() => {
    if (!highlightedTransactionId || transactions.length === 0) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`transaction-${highlightedTransactionId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [highlightedTransactionId, transactions]);

  const groupedTransactions = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    transactions.forEach((transaction) => {
      const group = groups.get(transaction.date) ?? [];
      group.push(transaction);
      groups.set(transaction.date, group);
    });
    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items,
      net: items.reduce((sum, item) => sum + signedValue(item), 0),
    }));
  }, [transactions]);

  const dayFlow = calendar?.days.find((d) => d.date === selectedDate);
  const periodTotals = useMemo(() => {
    if (periodMode === "rolling30" && scope === "mes") {
      return monthTransactions.reduce(
        (totals, transaction) => {
          if (transaction.status !== "pago") return totals;
          if (transaction.type === "receita") totals.income += transaction.value;
          if (transaction.type === "despesa") totals.expense += transaction.value;
          return totals;
        },
        { income: 0, expense: 0 },
      );
    }
    return null;
  }, [periodMode, scope, monthTransactions]);

  const strip =
    scope === "dia"
      ? {
          income: dayFlow?.income ?? 0,
          expense: dayFlow?.expense ?? 0,
          projectedIncome: dayFlow?.projected_income ?? 0,
          projectedExpense: dayFlow?.projected_expense ?? 0,
        }
      : {
          income: periodTotals?.income ?? calendar?.income ?? 0,
          expense: periodTotals?.expense ?? calendar?.expense ?? 0,
          projectedIncome: calendar?.projected_income ?? 0,
          projectedExpense: calendar?.projected_expense ?? 0,
        };
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: async () => {
      toast.success("Transação excluída.");
      setPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
        queryClient.invalidateQueries({ queryKey: ["trends"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const hasFilters = type !== "todos" || status !== "todos" || categoryId !== "todas" || accountId !== "todas" || deferredSearch.trim() !== "";

  const clearFilters = () => {
    setSearch("");
    setType("todos");
    setStatus("todos");
    setCategoryId("todas");
    setSelectedDonutCategory(null);
    setAccountId("todas");
  };

  return (
    <div className="relative flex flex-col gap-4 animate-fade-up">
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-start gap-x-3 gap-y-3" data-testid="flow-header-grid">
        <div className="min-w-0 pt-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Fluxo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe o que entrou, saiu e o que vem pela frente.</p>
        </div>

        <div className="row-span-2 flex justify-end self-start" data-testid="flow-view-rail">
          <div className="flex flex-col gap-1 rounded-full border border-border bg-card/80 p-1 shadow-sm backdrop-blur">
            {([
              { key: "calendario" as const, label: "Calendário", icon: CalendarDays },
              { key: "categorias" as const, label: "Análise", icon: ChartPie },
              { key: "lista" as const, label: "Lista", icon: List },
            ]).map((item) => (
              <Button
                key={item.key}
                type="button"
                size="icon"
                variant={flowView === item.key ? "default" : "ghost"}
                className="rounded-full"
                onClick={() => setFlowView(item.key)}
                aria-label={`Visualizar ${item.label}`}
                aria-pressed={flowView === item.key}
                title={item.label}
                data-testid={`flow-view-${item.key}`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-border bg-background/95 px-5 py-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="grid grid-cols-3 items-center gap-3">
            <div className="contents" data-testid="flow-strip-real">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:text-[10px]">Entrada</p>
                <p className="mt-1 whitespace-nowrap font-heading text-[clamp(0.78rem,3vw,1rem)] font-bold tabular-nums text-income sm:text-base">{money(strip.income)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:text-[10px]">Saída</p>
                <p className="mt-1 whitespace-nowrap font-heading text-[clamp(0.78rem,3vw,1rem)] font-bold tabular-nums text-expense sm:text-base">{money(strip.expense)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:text-[10px]">Saldo</p>
                <p className="mt-1 whitespace-nowrap font-heading text-[clamp(0.78rem,3vw,1rem)] font-bold tabular-nums text-foreground sm:text-base">{money(strip.income - strip.expense)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="icon" variant={showSearch ? "default" : "outline"} onClick={() => setShowSearch((v) => !v)}
          aria-label="Buscar transações" aria-expanded={showSearch} data-testid="toolbar-search-toggle">
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="flex flex-1 justify-center gap-1 rounded-full border border-border bg-muted/60 p-1" role="group" aria-label="Ver por dia ou por mês">
          {([{ key: "dia" as const, label: "Dia" }, { key: "mes" as const, label: "Mês" }]).map((option) => (
            <button key={option.key} type="button" onClick={() => setScope(option.key)} aria-pressed={scope === option.key}
              className={cn("flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150", scope === option.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              data-testid={`scope-${option.key}`}>{option.label}</button>
          ))}
        </div>
        <Button size="icon" variant={sortDir === "asc" ? "default" : "outline"} onClick={() => setSortDir((v) => (v === "desc" ? "asc" : "desc"))}
          aria-label={sortDir === "desc" ? "Ordenar das mais antigas para as mais recentes" : "Ordenar das mais recentes para as mais antigas"} data-testid="toolbar-sort-toggle">
          {sortDir === "desc" ? <ArrowDown className="h-4 w-4 animate-in fade-in slide-in-from-top-1" /> : <ArrowUp className="h-4 w-4 animate-in fade-in slide-in-from-bottom-1" />}
        </Button>
        <div className="shrink-0" data-testid="toolbar-period-selector">
          <MonthSelector month={month} onChange={changeMonth} />
        </div>
        <Button size="icon" variant={showFilters || hasFilters ? "default" : "outline"} onClick={() => setShowFilters((v) => !v)}
          aria-label="Filtros" aria-expanded={showFilters} data-testid="toolbar-filter-toggle"><Filter className="h-4 w-4" /></Button>
      </div>

      <p className="-mt-4 text-xs text-muted-foreground" data-testid="scope-label">
        {scope === "dia" ? formatDate(selectedDate) : periodMode === "rolling30" ? "Últimos 30 dias" : monthLabel(month)} · {sortDir === "desc" ? "mais recentes primeiro" : "mais antigas primeiro"}
      </p>

      {showSearch ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome…" className="pl-9 pr-9" autoFocus />
          {search ? <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button> : null}
        </div>
      ) : null}

      {showFilters ? (
        <div className="relative -mt-4 ml-auto w-[min(22rem,calc(100vw-3rem))] rounded-2xl border border-border bg-popover p-3 shadow-xl" data-testid="filters-panel">
          <span className="absolute -top-2 right-4 h-4 w-4 rotate-45 border-l border-t border-border bg-popover" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={type} onValueChange={(v) => setType(v as TxType | "todos")}><SelectTrigger size="sm"><SelectValue>{type === "todos" ? "Todos os tipos" : TX_TYPE_LABEL[type]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="todos">Todos os tipos</SelectItem><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem><SelectItem value="transferencia">Transferência</SelectItem></SelectContent></Select>
            <Select value={status} onValueChange={(v) => setStatus(v as TxStatus | "todos")}><SelectTrigger size="sm"><SelectValue>{status === "todos" ? "Todos os status" : TX_STATUS_LABEL[status]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="todos">Todos os status</SelectItem><SelectItem value="pago">Pago</SelectItem><SelectItem value="pendente">Pendente</SelectItem><SelectItem value="agendado">Agendado</SelectItem></SelectContent></Select>
            <Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger size="sm"><SelectValue>{categoryId === "todas" ? "Todas as categorias" : categories.find((x) => x.id === categoryId)?.name}</SelectValue></SelectTrigger><SelectContent><SelectItem value="todas">Todas as categorias</SelectItem>{categories.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
            <Select value={accountId} onValueChange={setAccountId}><SelectTrigger size="sm"><SelectValue>{accountId === "todas" ? "Todas as contas" : accounts.find((x) => x.id === accountId)?.name}</SelectValue></SelectTrigger><SelectContent><SelectItem value="todas">Todas as contas</SelectItem>{accounts.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
          </div>
          {hasFilters ? <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={clearFilters}>Limpar filtros</Button> : null}
        </div>
      ) : null}

      {flowView === "calendario" ? (
        <TransactionCalendar
          month={month}
          days={calendar?.days ?? []}
          selectedDate={selectedDate}
          expanded={calendarExpanded}
          onToggleExpanded={() => setCalendarExpanded((value) => !value)}
          onMonthChange={changeMonth}
          onSelectDate={pickDate}
        />
      ) : null}

      {flowView === "categorias" ? (() => {
        const expenseTransactions = monthTransactions.filter((transaction) => transaction.type === "despesa" && transaction.status === "pago");
        const categoryMap = new Map<string, { category_id: string | null; name: string; color: string; icon: string; total: number }>();
        expenseTransactions.forEach((transaction) => {
          const key = transaction.category_id ?? "__uncategorized__";
          const existing = categoryMap.get(key);
          if (existing) existing.total += transaction.value;
          else categoryMap.set(key, {
            category_id: transaction.category_id ?? null,
            name: transaction.category_name ?? "Sem categoria",
            color: transaction.category_color ?? "#64748B",
            icon: transaction.category_icon ?? "more-horizontal",
            total: transaction.value,
          });
        });
        const totalExpense = expenseTransactions.reduce((sum, transaction) => sum + transaction.value, 0);
        const slices = Array.from(categoryMap.values())
          .map((item) => ({ ...item, percent: totalExpense > 0 ? (item.total / totalExpense) * 100 : 0 }))
          .sort((a, b) => b.total - a.total);
        return (
          <ExpensesDonutChart
            month={month}
            periodLabel={periodMode === "rolling30" ? "Últimos 30 dias" : undefined}
            slices={slices}
            total={totalExpense}
            selectedCategoryId={selectedDonutCategory}
            onSelectCategory={(slice) => {
              const nextCategoryId = slice?.category_id ?? null;
              setSelectedDonutCategory(nextCategoryId);
              setCategoryId(nextCategoryId ?? "todas");
              setType(nextCategoryId ? "despesa" : "todos");
              setScope("mes");
            }}
            onOpenCategory={(slice) => {
              const nextCategoryId = slice.category_id ?? null;
              setSelectedDonutCategory(nextCategoryId);
              setCategoryId(nextCategoryId ?? "todas");
              setType("despesa");
              setScope("mes");
            }}
          />
        );
      })() : null}

      {categoryId !== "todas" && (flowView === "lista" || (flowView === "categorias" && selectedDonutCategory)) ? (() => {
        const selectedCategory = categories.find((category) => category.id === categoryId);
        const categoryTotal = transactions
          .filter((transaction) => transaction.type === "despesa")
          .reduce((sum, transaction) => sum + transaction.value, 0);
        return (
          <div className="rounded-2xl border border-border bg-card px-4 py-3" data-testid="selected-category-summary">
            <p className="text-xs font-medium text-muted-foreground">
              {flowView === "categorias" ? "Transações de " : "Total em "}{selectedCategory?.name ?? "categoria"}
            </p>
            <p className="mt-1 font-heading text-xl font-bold tabular-nums text-expense">
              {hidden ? formatHiddenBRL() : formatBRL(categoryTotal)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {transactions.length} {transactions.length === 1 ? "transação" : "transações"} · {periodMode === "rolling30" ? "últimos 30 dias" : monthLabel(month)}
            </p>
          </div>
        );
      })() : null}

      {flowView !== "categorias" || selectedDonutCategory ? (
      transactionsQuery.isPending ? (
        <FinnosPageLoading title="Carregando transações" description="Buscando seus lançamentos do período." />
      ) : transactionsQuery.error ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="transactions-error-message">
              Não foi possível carregar as transações. Tente novamente.
            </p>
            <Button variant="outline" onClick={() => transactionsQuery.refetch()} data-testid="transactions-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<PlusCircle className="h-5 w-5" aria-hidden="true" />}
          title={scope === "dia" ? `Nenhuma transação em ${formatDate(selectedDate)}` : "Nenhuma transação encontrada no período"}
          description={
            scope === "dia"
              ? selectedDate > todayISO()
                ? "Não há nenhuma movimentação programada para esta data."
                : "Não há nenhuma movimentação registrada nesta data."
              : "Ajuste os filtros ou registre uma nova movimentação para começar."
          }
          action={
            <Button onClick={() => dialogs.openTransaction()} data-testid="transactions-empty-add-button">
              Adicionar transação
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="transactions-count">
            {transactions.length} {transactions.length === 1 ? "transação" : "transações"}
          </p>

          <div className="hidden rounded-2xl border border-border bg-card md:block" data-testid="transactions-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Transação</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id} id={`transaction-${t.id}`} data-testid="transaction-row" className={cn(highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{t.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.fixed ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Fixa · {t.recurrence}</Badge>
                        ) : null}
                        {t.status !== "pago" && t.notify_enabled === false ? (
                          <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                            <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                          </Badge>
                        ) : null}
                        {t.installment && t.total_installments ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {t.current_installment}/{t.total_installments} · {t.total_installments}x de {formatBRLShort(t)}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.category_name ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.category_color ?? "#64748B" }} aria-hidden="true" />
                          {t.category_name}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.account_name}
                      {t.to_account_name ? <span className="text-muted-foreground"> → {t.to_account_name}</span> : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                      )}
                      data-testid="transaction-value"
                    >
                      {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => dialogs.openTransaction({ transaction: t })}
                          aria-label={`Editar ${t.name}`}
                          data-testid={`edit-transaction-${t.id}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(t)}
                          aria-label={`Excluir ${t.name}`}
                          data-testid={`delete-transaction-${t.id}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-5 md:hidden" data-testid="transactions-card-list">
            {groupedTransactions.map((group) => (
              <section key={group.date} className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="transaction-day-group">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <p className="font-heading text-sm font-bold text-foreground">
                      {group.date === todayISO() ? "Hoje · " : ""}{formatDate(group.date)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {group.items.length} {group.items.length === 1 ? "lançamento" : "lançamentos"}
                    </p>
                  </div>
                  <p className={cn(
                    "shrink-0 font-heading text-sm font-bold tabular-nums",
                    group.net > 0 ? "text-income" : group.net < 0 ? "text-expense" : "text-foreground",
                  )}>
                    {hidden ? formatHiddenBRL() : formatSignedBRL(group.net)}
                  </p>
                </div>

                <div className="divide-y divide-border">
                  {group.items.map((t) => (
                    <div key={t.id} id={`transaction-${t.id}`} className={cn("px-4 py-3.5 transition-colors", highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")} data-testid="transaction-card">
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                          style={{
                            backgroundColor: (t.category_color ?? "#64748B") + "1A",
                            color: t.category_color ?? "#64748B",
                          }}
                          aria-hidden="true"
                        >
                          <CategoryIcon name={t.category_icon ?? "more-horizontal"} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{t.name}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {[t.category_name ?? (t.type === "transferencia" ? "Transferência" : "Sem categoria"), t.account_name]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <p className={cn(
                              "shrink-0 font-heading text-base font-bold tabular-nums",
                              t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                            )}>
                              {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                            </p>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap gap-1">
                              <StatusBadge status={t.status} />
                              {t.fixed ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Fixa</Badge> : null}
                              {t.status !== "pago" && t.notify_enabled === false ? (
                                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                                  <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                                </Badge>
                              ) : null}
                              {t.installment && t.total_installments ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t.current_installment}/{t.total_installments}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Button size="icon-sm" variant="ghost" onClick={() => dialogs.openTransaction({ transaction: t })} aria-label={`Editar ${t.name}`} data-testid={`edit-transaction-${t.id}`}>
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPendingDelete(t)} aria-label={`Excluir ${t.name}`} data-testid={`delete-transaction-${t.id}`}>
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir transação?"
        description={pendingDelete ? `"${pendingDelete.name}" será removida permanentemente.` : ""}
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}

function formatBRLShort(t: Transaction): string {
  const value = t.installment_value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
