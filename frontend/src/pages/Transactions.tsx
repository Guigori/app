import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useIsRestoring, useRouteState } from "@/lib/routeState";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { canGoBack } from "@/lib/navigation";
import { CategoryInsight } from "@/components/transactions/CategoryInsight";
import { ArrowDown, ArrowLeft, ArrowUp, BellOff, Wallet, CalendarDays, ChartPie, Filter, List, Pencil, PlusCircle, ChevronRight, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteTransaction, fetchAccounts, fetchCalendar, fetchCategories, fetchTransactions, fetchTransactionsPage, isTransactionListComplete } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { isLocalMode } from "@/lib/mode";
import { listSyncOperations } from "@/lib/sync/queue";
import { settledCents, settledTotals } from "@/lib/settledMoney";
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
import { PlannedCharges } from "@/components/subscriptions/PlannedCharges";
import { PendingCaptures } from "@/components/pending/PendingCaptures";
import { captureBadge, matchesCaptureFilter, type CaptureFilter } from "@/lib/pendingCaptures";
import { plannedInView } from "@/lib/subscriptionsView";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { StatusBadge } from "@/components/shared/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Transaction, TxStatus, TxType } from "@/types/finnos";

// Caixa (entrou, saiu, projeção) is a tab of Fluxo; its charts load only when it is opened.
const Flow = lazy(() => import("@/pages/Flow"));

function signedValue(t: Transaction): number {
  return t.type === "receita" ? t.value : -t.value;
}

const CAPTURE_FILTER_LABEL: Record<CaptureFilter, string> = {
  todas: "Todas as origens",
  apple_pay: "Origem: Apple Pay",
  apple_pay_auto: "Origem: Apple Pay automático",
};

/** "Apple Pay", "Apple Pay · automático" (and "valor alto"): so these lançamentos are easy to spot. */
function CaptureMark({ t }: { t: Transaction }) {
  return (
    <Badge variant="secondary" className={cn("px-1.5 py-0 text-xs", t.capture_unusual && "bg-amber-500/15 text-amber-800 dark:text-amber-300")} data-testid="transaction-capture">
      {captureBadge(t)}
    </Badge>
  );
}

export default function Transactions() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Opened from another screen through a link (a category, a total, a day): offer the way back.
  const location = useLocation();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- recomputed per history entry
  const cameFromLink = useMemo(() => canGoBack() && ["category_id", "metric", "date", "month", "origem", "highlight"].some((k) => searchParams.has(k)), [location.key]);
  const linkedDate = searchParams.get("date");
  const linkedMonth = searchParams.get("month");
  const linkedMetric = searchParams.get("metric");
  const linkedCategoryId = searchParams.get("category_id");
  const highlightedTransactionId = searchParams.get("highlight");
  const { hidden } = useBalanceHidden();
  // Coming back to this entry: keep what the user had, instead of re-applying the link.
  const restoring = useIsRestoring();

  const [month, setMonth] = useRouteState("fluxo:month", currentMonth);
  const [periodMode, setPeriodMode] = useState<"rolling30" | "month">("month");
  const [flowView, setFlowView] = useRouteState<"calendario" | "categorias" | "lista" | "caixa">("fluxo:view", "calendario");
  // ?aba=caixa (Entrada / Saída / Saldo, the old /fluxo address, every "Ver no Caixa") opens the Caixa tab.
  const linkedTab = searchParams.get("aba");
  const [selectedDate, setSelectedDate] = useRouteState("fluxo:date", todayISO);
  const [scope, setScope] = useRouteState<"dia" | "mes">("fluxo:scope", "mes");
  // Planned behaviour: compact week on phones (drag the handle for more), full month from tablet up.
  const [calendarExpanded, setCalendarExpanded] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches);
  const [search, setSearch] = useState("");
  const [type, setType] = useRouteState<"todos" | TxType>("fluxo:type", "todos");
  const [status, setStatus] = useState<"todos" | TxStatus>("todos");
  // "?origem=apple-pay" / "apple-pay-auto" (from the Apple Pay card in Início) opens filtered.
  const [captureFilter, setCaptureFilter] = useState<CaptureFilter>(() => ({ "apple-pay": "apple_pay", "apple-pay-auto": "apple_pay_auto" } as Record<string, CaptureFilter>)[searchParams.get("origem") ?? ""] ?? "todas");
  const [categoryId, setCategoryId] = useRouteState("fluxo:category", "todas");
  const [selectedDonutCategory, setSelectedDonutCategory] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("todas");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [hasPendingSync, setHasPendingSync] = useState(true);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refreshQueue = () => {
      if (isLocalMode()) {
        if (mounted) setHasPendingSync(false);
        return;
      }
      void listSyncOperations()
        .then((operations) => { if (mounted) setHasPendingSync(operations.length > 0); })
        .catch(() => { if (mounted) setHasPendingSync(true); });
    };
    refreshQueue();
    window.addEventListener("finnos:sync-state", refreshQueue);
    return () => { mounted = false; window.removeEventListener("finnos:sync-state", refreshQueue); };
  }, []);

  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (restoring || !linkedDate || !/^\d{4}-\d{2}-\d{2}$/.test(linkedDate)) return;
    setPeriodMode("month");
    setMonth(linkedDate.slice(0, 7));
    setSelectedDate(linkedDate);
    setScope("dia");
    setFlowView("calendario");
  }, [linkedDate, restoring, setMonth, setSelectedDate, setScope, setFlowView]);

  useEffect(() => {
    if (restoring || linkedDate) return;
    if (linkedMonth && /^\d{4}-\d{2}$/.test(linkedMonth)) {
      setPeriodMode("month");
      setMonth(linkedMonth);
      setSelectedDate(todayISO().slice(0, 7) === linkedMonth ? todayISO() : `${linkedMonth}-01`);
      setScope("mes");
    }
    // In Caixa, metric / category / account belong to the Caixa view, not to the list filters.
    if (linkedTab === "caixa") {
      setFlowView("caixa");
      return;
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
  }, [linkedCategoryId, linkedDate, linkedMetric, linkedMonth, linkedTab, restoring, setMonth, setSelectedDate, setScope, setCategoryId, setType, setFlowView]);


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
  // The calendar follows the category filter, so its days and planned charges match the list.
  const calendarCategory = categoryId === "todas" ? undefined : categoryId;
  const calendarQuery = useQuery({ queryKey: ["calendar", month, calendarCategory ?? "todas"], queryFn: () => fetchCalendar(month, calendarCategory) });
  const calendar = calendarQuery.data;
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

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

  // Paginate every online List filter using bounded Firestore date scans.
  // Offline or unresolved sync entries keep the local overlay/legacy path;
  // calendars and charts retain their independent aggregate data source.
  const pagedList = flowView === "lista" && !highlightedTransactionId
    && online && !hasPendingSync;
  const transactionsQuery = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => fetchTransactions(filters),
    enabled: !pagedList,
  });
  const pagesQuery = useInfiniteQuery({
    queryKey: ["transactions", "pages", filters, sortDir],
    queryFn: ({ pageParam }) =>
      fetchTransactionsPage(filters, pageParam ?? undefined, 50, sortDir),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: pagedList,
  });
  // Search may return zero matches in a bounded batch while more records
  // remain. Advance the cursor rather than showing a misleading empty state.
  useEffect(() => {
    if (!pagedList || !pagesQuery.hasNextPage || pagesQuery.isFetching) return;
    if (pagesQuery.data?.pages.at(-1)?.items.length === 0) {
      void pagesQuery.fetchNextPage();
    }
    // The query object itself is new every render; its fields are the real inputs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pagedList, pagesQuery.data, pagesQuery.hasNextPage, pagesQuery.isFetching, pagesQuery.fetchNextPage]);
  const monthTransactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data]);
  const transactions = useMemo(() => (pagedList
    ? pagesQuery.data?.pages.flatMap(page => page.items) ?? []
    : monthTransactions.slice().sort((a, b) => (sortDir === "desc"
      ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))).filter((t) => matchesCaptureFilter(t, captureFilter)), [pagedList, pagesQuery.data, monthTransactions, sortDir, captureFilter]);
  // AUD-07: offline, say when only the pages loaded online are available.
  const completenessQuery = useQuery({
    queryKey: ["transactions", "complete", filters, online],
    queryFn: () => isTransactionListComplete(filters),
    enabled: !online && !pagedList,
  });
  const partialOffline = !online && !pagedList && completenessQuery.data === false;
  const listPending = pagedList ? pagesQuery.isPending : transactionsQuery.isPending;
  const listError = pagedList ? (!pagesQuery.data ? pagesQuery.error : null) : transactionsQuery.error;
  const retryList = () => { if (pagedList) void pagesQuery.refetch(); else void transactionsQuery.refetch(); };
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
      net: items.reduce((sum, item) => sum + (item.type === "receita" ? settledCents(item) : -settledCents(item)), 0) / 100,
    }));
  }, [transactions]);

  const dayFlow = calendar?.days.find((d) => d.date === selectedDate);
  // Independent complete-calendar aggregation, never totals of partial
  // transaction pages. Both months are needed for a 30-day rolling window.
  const rollingStart = rollingRange.start.slice(0, 7);
  const rollingEnd = rollingRange.end.slice(0, 7);
  const rollingCalendarsQuery = useQuery({
    queryKey: ["calendar", "rolling30", rollingStart, rollingEnd, calendarCategory ?? "todas"],
    queryFn: async () => Promise.all(
      [...new Set([rollingStart, rollingEnd])].map((m) => fetchCalendar(m, calendarCategory)),
    ),
    enabled: periodMode === "rolling30" && scope === "mes" && pagedList,
  });
  const periodTotals = useMemo(() => {
    if (periodMode !== "rolling30" || scope !== "mes") return null;
    if (!pagedList) return { ...settledTotals(monthTransactions), projectedIncome: calendar?.projected_income ?? 0, projectedExpense: calendar?.projected_expense ?? 0 };
    const days = (rollingCalendarsQuery.data ?? []).flatMap(c => c.days)
      .filter(day => day.date >= rollingRange.start && day.date <= rollingRange.end);
    return days.reduce(
      (total, day) => ({
        income: total.income + day.income,
        expense: total.expense + day.expense,
        projectedIncome: total.projectedIncome + day.projected_income,
        projectedExpense: total.projectedExpense + day.projected_expense,
      }),
      { income: 0, expense: 0, projectedIncome: 0, projectedExpense: 0 },
    );
  }, [periodMode, scope, pagedList, monthTransactions, calendar?.projected_income, calendar?.projected_expense,
      rollingCalendarsQuery.data, rollingRange]);

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
          projectedIncome: periodTotals?.projectedIncome ?? calendar?.projected_income ?? 0,
          projectedExpense: periodTotals?.projectedExpense ?? calendar?.projected_expense ?? 0,
        };
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  // Tapping a lançamento explains it; the edit and delete buttons inside keep their own action.
  const detailProps = (t: Transaction) => ({
    tabIndex: 0,
    "aria-label": `Ver detalhes de ${t.name}`,
    onClick: (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("button, a")) return;
      dialogs.openTransactionDetail(t, transactions);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); dialogs.openTransactionDetail(t, transactions); }
    },
  });
  const rolling = periodMode === "rolling30" && scope === "mes";
  const planned = plannedInView(
    (rolling ? (rollingCalendarsQuery.data ?? []).flatMap((c) => c.planned ?? []) : calendar?.planned) ?? [],
    {
      from: scope === "dia" ? selectedDate : rolling ? rollingRange.start : `${month}-01`,
      to: scope === "dia" ? selectedDate : rolling ? rollingRange.end : `${month}-31`,
      type, status, accountId, search: deferredSearch,
    },
  );

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

  const hasFilters = captureFilter !== "todas" || type !== "todos" || status !== "todos" || categoryId !== "todas" || accountId !== "todas" || deferredSearch.trim() !== "";

  const clearFilters = () => {
    setSearch("");
    setType("todos");
    setStatus("todos");
    setCaptureFilter("todas");
    setCategoryId("todas");
    setSelectedDonutCategory(null);
    setAccountId("todas");
  };

  return (
    <div className="relative flex flex-col gap-4 animate-fade-up">
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]" data-testid="flow-header-grid">
        <div className="min-w-0 pt-1">
          {cameFromLink ? (
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="mb-3 size-10 rounded-full border border-border bg-card text-foreground hover:bg-muted" aria-label="Voltar para a tela anterior" title="Voltar" data-testid="flow-back-button">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : null}
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Fluxo</h1>
          <p className="mt-1 text-sm text-muted-foreground">O que entrou, saiu e o que vem pela frente.</p>
        </div>

        {/* Always a horizontal, labelled segmented control: no vertical rail eating a column. */}
        <div className="flex self-start sm:justify-end" data-testid="flow-view-rail">
          <div className="grid w-full grid-cols-4 gap-1 rounded-2xl border border-border bg-card p-1 sm:flex sm:w-auto sm:rounded-full">
            {([
              { key: "calendario" as const, label: "Calendário", icon: CalendarDays },
              { key: "categorias" as const, label: "Análise", icon: ChartPie },
              { key: "lista" as const, label: "Lista", icon: List },
              { key: "caixa" as const, label: "Caixa", icon: Wallet },
            ]).map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={flowView === item.key ? "default" : "ghost"}
                className="h-10 gap-1.5 rounded-xl px-2 sm:h-9 sm:rounded-full sm:px-3"
                onClick={() => setFlowView(item.key)}
                aria-label={`Visualizar ${item.label}`}
                aria-pressed={flowView === item.key}
                title={item.label}
                data-testid={`flow-view-${item.key}`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs font-semibold">{item.label}</span>
              </Button>
            ))}
          </div>
        </div>

        {flowView !== "caixa" ? <div className="min-w-0 rounded-2xl border border-border bg-card px-5 py-4 sm:col-span-2">
          {/* Same period as Início and Caixa, so the numbers always match. */}
          <p className="mb-2 text-xs text-muted-foreground" data-testid="flow-strip-period">
            {scope === "dia" ? formatDate(selectedDate) : periodMode === "rolling30" ? "Últimos 30 dias" : monthLabel(month)}
          </p>
          <div className="grid grid-cols-3 items-center gap-3">
            <div className="contents" data-testid="flow-strip-real">
              <Link to={`/transacoes?aba=caixa&metric=receitas&month=${month}`} className="group -m-2 min-w-0 rounded-xl p-2 transition-colors hover:bg-muted/60" aria-label="Ver no Caixa: entrada" data-testid="flow-strip-receitas">
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Entrada<ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" /></p>
                <p className="mt-1 break-words font-heading text-[12px] font-bold tabular-nums text-income sm:text-base">{money(strip.income)}</p>
              </Link>
              <Link to={`/transacoes?aba=caixa&metric=despesas&month=${month}`} className="group -m-2 min-w-0 rounded-xl p-2 transition-colors hover:bg-muted/60" aria-label="Ver no Caixa: saída" data-testid="flow-strip-despesas">
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Saída<ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" /></p>
                <p className="mt-1 break-words font-heading text-[12px] font-bold tabular-nums text-expense sm:text-base">{money(strip.expense)}</p>
              </Link>
              <Link to={`/transacoes?aba=caixa&metric=caixa&month=${month}`} className="group -m-2 min-w-0 rounded-xl p-2 transition-colors hover:bg-muted/60" aria-label="Ver no Caixa: saldo" data-testid="flow-strip-caixa">
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Saldo<ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" /></p>
                <p className="mt-1 break-words font-heading text-[12px] font-bold tabular-nums text-foreground sm:text-base">{money(strip.income - strip.expense)}</p>
              </Link>
            </div>
          </div>
        </div> : null}
      </div>

      <PendingCaptures />

      {flowView === "caixa" ? (
        <Suspense fallback={<FinnosPageLoading title="Abrindo o Caixa" />}>
          <Flow month={month} onMonthChange={changeMonth} />
        </Suspense>
      ) : <>

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

      <p className="-mt-4 hidden text-xs text-muted-foreground sm:block" data-testid="scope-label">
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
            <Select value={captureFilter} onValueChange={(v) => setCaptureFilter(v as CaptureFilter)}><SelectTrigger size="sm" className="col-span-2" data-testid="filter-capture"><SelectValue>{CAPTURE_FILTER_LABEL[captureFilter]}</SelectValue></SelectTrigger><SelectContent>{(Object.keys(CAPTURE_FILTER_LABEL) as CaptureFilter[]).map((k) => <SelectItem key={k} value={k}>{CAPTURE_FILTER_LABEL[k]}</SelectItem>)}</SelectContent></Select>
          </div>
          {hasFilters ? <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={clearFilters}>Limpar filtros</Button> : null}
        </div>
      ) : null}

      {/* Desktop: compact calendar on the left (sticky) and the day list beside it. */}
      <div className={flowView === "calendario" ? "flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:items-start lg:gap-6" : "contents"}>
      {flowView === "calendario" ? (
        <div className="lg:sticky lg:top-6">
        <TransactionCalendar
          month={month}
          days={calendar?.days ?? []}
          selectedDate={selectedDate}
          expanded={calendarExpanded}
          onToggleExpanded={() => setCalendarExpanded((value) => !value)}
          onMonthChange={changeMonth}
          onSelectDate={pickDate}
        />
        </div>
      ) : null}

      {flowView === "categorias" ? (() => {
        const expenseTransactions = monthTransactions.filter((transaction) => transaction.type === "despesa" && transaction.status === "pago");
        const categoryMap = new Map<string, { category_id: string | null; name: string; color: string; icon: string; total: number }>();
        expenseTransactions.forEach((transaction) => {
          const key = transaction.category_id ?? "__uncategorized__";
          const existing = categoryMap.get(key);
          if (existing) existing.total += settledCents(transaction);
          else categoryMap.set(key, {
            category_id: transaction.category_id ?? null,
            name: transaction.category_name ?? "Sem categoria",
            color: transaction.category_color ?? "#64748B",
            icon: transaction.category_icon ?? "more-horizontal",
            total: settledCents(transaction),
          });
        });
        const totalExpenseCents = expenseTransactions.reduce((sum, transaction) => sum + settledCents(transaction), 0);
        const totalExpense = totalExpenseCents / 100;
        const slices = Array.from(categoryMap.values())
          .map((item) => ({ ...item, total: item.total / 100, percent: totalExpenseCents > 0 ? (item.total / totalExpenseCents) * 100 : 0 }))
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

      {flowView === "categorias" && selectedDonutCategory && categoryId !== "todas" && periodMode === "month" ? (
        <CategoryInsight
          categoryId={categoryId}
          month={month}
          monthExpense={scope === "mes" ? calendar?.expense : undefined}
          onPickMonth={changeMonth}
          onPickName={(name) => { setSearch(name); setShowSearch(true); }}
        />
      ) : categoryId !== "todas" && (flowView === "lista" || (flowView === "categorias" && selectedDonutCategory)) ? (() => {
        const selectedCategory = categories.find((category) => category.id === categoryId);
        const categoryTotal = transactions
          .filter((transaction) => transaction.type === "despesa")
          .reduce((sum, transaction) => sum + settledCents(transaction), 0) / 100;
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

      {partialOffline && (
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="transactions-offline-partial">
          Sem conexão: mostrando só as páginas carregadas antes. Conecte-se para ver todos os lançamentos do período.
        </p>
      )}
      {flowView !== "categorias" ? <PlannedCharges items={planned} categories={categories} hidden={hidden} /> : null}
      {flowView !== "categorias" || selectedDonutCategory ? (
      <div className="min-w-0">{
      listPending ? (
        <FinnosPageLoading title="Carregando transações" description="Buscando seus lançamentos do período." />
      ) : listError ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="transactions-error-message">
              Não foi possível carregar as transações. Tente novamente.
            </p>
            <Button variant="outline" onClick={retryList} data-testid="transactions-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : transactions.length === 0 ? (planned.length && flowView !== "categorias" ? null : (
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
      )) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="transactions-count">
            {transactions.length} {transactions.length === 1 ? "transação" : "transações"}{pagedList ? " carregadas" : ""}
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
                  <TableRow key={t.id} id={`transaction-${t.id}`} {...detailProps(t)} data-testid="transaction-row" className={cn("cursor-pointer", highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{t.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.fixed ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-xs">Fixa · {t.recurrence}</Badge>
                        ) : null}
                        {t.status !== "pago" && t.notify_enabled === false ? (
                          <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs">
                            <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                          </Badge>
                        ) : null}
                        {t.installment && t.total_installments ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                            {t.current_installment}/{t.total_installments} · {t.total_installments}x de {formatBRLShort(t)}
                          </Badge>
                        ) : null}
                        {captureBadge(t) ? <CaptureMark t={t} /> : null}
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
                    <div key={t.id} id={`transaction-${t.id}`} {...detailProps(t)} className={cn("cursor-pointer px-4 py-3.5 transition-colors hover:bg-muted/40", highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")} data-testid="transaction-card">
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
                              {t.fixed ? <Badge variant="secondary" className="px-1.5 py-0 text-xs">Fixa</Badge> : null}
                              {t.status !== "pago" && t.notify_enabled === false ? (
                                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs">
                                  <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                                </Badge>
                              ) : null}
                              {t.installment && t.total_installments ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                                  {t.current_installment}/{t.total_installments}
                                </Badge>
                              ) : null}
                              {captureBadge(t) ? <CaptureMark t={t} /> : null}
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
          {pagedList && pagesQuery.hasNextPage ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" disabled={pagesQuery.isFetchingNextPage}
                onClick={() => void pagesQuery.fetchNextPage()} data-testid="transactions-load-more">
                {pagesQuery.isFetchingNextPage ? "Carregando mais..." : "Carregar mais 50 transações"}
              </Button>
            </div>
          ) : null}
          {pagedList && pagesQuery.isFetchNextPageError ? (
            <div role="alert" className="space-y-2 rounded-xl border p-3 text-sm">
              Não foi possível carregar a próxima página. Os lançamentos exibidos foram preservados.
              <Button type="button" size="sm" variant="outline"
                onClick={() => void pagesQuery.fetchNextPage()}>Tentar novamente</Button>
            </div>
          ) : null}
        </>
      )
      }</div>
      ) : null}
      </div>
      </>}

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
