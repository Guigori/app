/**
 * Orçamento · Fechar o mês, numa página só. Em cima, o que aconteceu (planejado × realizado) e os gráficos do mês;
 * depois os previstos (contas e recebimentos), cartões e parcelas, assinaturas, metas, categorias, o que divergiu,
 * tudo o que foi registrado, a análise e o destino da sobra. Blocos sem nada a mostrar não aparecem.
 * Cada registro abre no registro novo (Fluxo); a sobra é registrada em cada módulo antes de fechar.
 * O Orçamento guarda só o retrato do fechamento (e, se você pedir, lembretes no plano do mês seguinte).
 */
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, Check, CheckCircle2, Circle, Lock, Plus, Printer, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { fetchBudget, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { openRegisterSheet } from "@/lib/registerSheet";
import { buildClosing } from "@/lib/budget/closing";
import { divergences, reviewBills, reviewGoals, reviewInstallments, reviewSubscriptions, type BillLine } from "@/lib/budget/review";
import type { BudgetClosing as Closing, PlanReminder } from "@/lib/budget/server";
import { detailPath } from "@/lib/insights/registry";
import { useBudgetClosings, useBudgetPlans } from "@/components/budget/usePlans";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { Bars, BulletBar, Donut, Heatmap, ProjectionLine, SegmentedBar } from "@/components/charts/FinnosCharts";
import { CatalogInsight } from "@/components/insights/CatalogInsight";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, dm, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { DeskHeader, DeskPage, useIsDesktop } from "@/components/budget/desktop/kit";
import { SobraPlanner, useSobraAllocs } from "@/components/budget/closing/SobraPlanner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BudgetSuccess } from "@/components/budget/BudgetSuccess";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types/finnos";

// Three analyses of the library read for the month being closed (the same ones Análise shows for that month).
const ANALYSES = ["fixo-x-variavel", "onde-economizou", "taxa-poupanca", "categorias-subiram", "maiores-gastos"];
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const lbl = "text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const r2 = (v: number) => Math.round(v * 100) / 100;
const amountOf = (t: Transaction) => (t.installment ? t.installment_value ?? t.value : t.value);

/** A card with an uppercase label, an optional note and an action on the right. Renders nothing when `show` is false. */
function Block({ title, note, action, children, className, id, testId, show = true }: { title: string; note?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string; testId?: string; show?: boolean }) {
  if (!show) return null;
  return (
    <section id={id} className={cn("min-w-0 scroll-mt-4 rounded-[20px] border border-border bg-card p-4 sm:p-5", className)} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3"><p className={lbl}>{title}</p>{action}</div>
      {note ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function BudgetClosing() {
  const [month, setMonth] = useBudgetMonth(addMonth(currentMonth(), -1));
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const dialogs = useDialogs();
  const { view, today, transactions, accounts, goals } = useMonthData(month);
  const next = addMonth(month, 1);
  const name = monthLabel(month).split(" ")[0].toLowerCase();
  const nextName = monthLabel(next).split(" ")[0].toLowerCase();
  const prevBudgets = useQueries({ queries: [1, 2, 3].map((n) => ({ queryKey: ["budget", addMonth(month, -n)], queryFn: () => fetchBudget(addMonth(month, -n)) })) });
  const hist = useQueries({ queries: [1, 2].map((n) => ({ queryKey: ["transactions", { month: addMonth(month, -n) }], queryFn: () => fetchTransactions({ month: addMonth(month, -n) }) })) });
  const prevData = hist[0].data;
  const prevTxs = useMemo(() => prevData ?? [], [prevData]);
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const closings = useBudgetClosings();
  const plans = useBudgetPlans();
  const record = closings.closingOf(month);
  const planned = plans.planOf(month);
  const nextPlan = plans.planOf(next);
  const hasPlan = planned.planned_income > 0 || planned.planned_bills > 0;

  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);
  const [success, setSuccess] = useState(false);
  const [allocs, setAllocs, clearAllocs] = useSobraAllocs(month);
  const [note, setNote] = useState("");
  const [q, setQ] = useState<string | null>(null);
  const [slice, setSlice] = useState<string | null>(null);
  const [recTab, setRecTab] = useState<"todos" | "contas" | "receitas" | "gastos">("todos");
  const [recAll, setRecAll] = useState(false);
  const scrollTo = (id: string) => { setSheet(false); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  const prev1 = prevBudgets[0].data;
  const c = useMemo(() => {
    if (!view) return null;
    const opening = view.projection.find((p) => p.kind === "real")?.value ?? 0;
    const closingBal = [...view.projection].reverse().find((p) => p.kind === "real")?.value ?? view.inAccounts;
    return buildClosing({ month, transactions, categories: view.categories, previous: Object.fromEntries((prev1?.rows ?? []).map((r) => [r.category_id, r.spent])), earned: view.earned, spent: view.spent, opening, closing: closingBal });
  }, [view, month, transactions, prev1]);
  const expected = planned.expected;
  const bills = useMemo(() => reviewBills(month, transactions, prevTxs, "despesa", expected ?? {}), [month, transactions, prevTxs, expected]);
  const incomes = useMemo(() => reviewBills(month, transactions, prevTxs, "receita", expected ?? {}), [month, transactions, prevTxs, expected]);
  const inst = useMemo(() => reviewInstallments(month, transactions), [month, transactions]);
  const subsReview = useMemo(() => reviewSubscriptions(subs.data?.items ?? [], today), [subs.data, today]);
  const goalRows = useMemo(() => reviewGoals(month, goals, planned.saving ?? {}), [month, goals, planned.saving]);
  const div = useMemo(() => (view ? divergences(month, transactions, prevTxs, view.categories) : null), [view, month, transactions, prevTxs]);
  // Average of the three months before, per category (the budget rows of each month).
  const avgBy = useMemo(() => {
    const sums = new Map<string, number>(); let n = 0;
    for (const b of prevBudgets) if (b.data) { n++; for (const r of b.data.rows) sums.set(r.category_id, (sums.get(r.category_id) ?? 0) + r.spent); }
    return n ? new Map([...sums].map(([k, v]) => [k, r2(v / n)])) : new Map<string, number>();
  }, [prevBudgets]);

  // Reminders the person asks for while closing go to next month's plan (shown in the Orçamento on the day).
  const reminders = nextPlan.reminders ?? [];
  const hasReminder = (id: string) => reminders.some((r) => r.id === id);
  const toggleReminder = (r: PlanReminder) => {
    const list = hasReminder(r.id) ? reminders.filter((x) => x.id !== r.id) : [...reminders, r];
    plans.save.mutate({ ...nextPlan, reminders: list }, { onSuccess: () => toast.success(hasReminder(r.id) ? "Lembrete tirado." : `Lembrete para ${dm(r.date)} em ${nextName}.`) });
  };

  const notOver = month >= currentMonth();
  const sobra = Math.max(0, c?.result ?? 0);
  const mainAccount = accounts.find((a) => a.active && a.type !== "beneficio" && a.is_default) ?? accounts.find((a) => a.active && a.type !== "beneficio");
  const pendingAllocs = allocs.filter((a) => a.value > 0 && !a.done);
  const overAlloc = r2(allocs.reduce((s, a) => s + a.value, 0) - sobra) > 0;

  const close = () => {
    if (!c || !view) return;
    const rec: Closing = { month, closed_at: new Date().toISOString(), earned: c.earned, spent: c.spent, result: c.result, daily_planned: c.dailyPlanned, daily_spent: c.dailySpent,
      planned_income: hasPlan ? planned.planned_income : null, planned_bills: hasPlan ? planned.planned_bills : null, allocation: allocs.filter((a) => a.value > 0),
      categories: c.categories.map((x) => ({ category_id: x.category_id, name: x.name, spent: x.spent, limit: x.limit })), note: note.trim() || null,
      estimates: [...bills.lines, ...incomes.lines].slice(0, 300).map((l) => ({ name: l.tx.name.slice(0, 120), type: l.tx.type as "receita" | "despesa", value: l.value, outcome: l.paid ? "aconteceu" as const : "aberto" as const })) };
    closings.close.mutate(rec, { onSuccess: () => { setSheet(false); clearAllocs(); setSuccess(true); } });
  };
  const share = async () => {
    const text = `${monthLabel(month)}: entrou ${money(c!.earned)}, saiu ${money(c!.spent)}, ${c!.result >= 0 ? "sobrou" : "faltou"} ${money(Math.abs(c!.result))}.`;
    if (navigator.share) { try { await navigator.share({ title: `Fechamento de ${name}`, text }); } catch { /* cancelled */ } }
    else { await navigator.clipboard?.writeText(text); toast.success("Resumo copiado."); }
  };

  if (!view || !c || !div) {
    const loading = <FinnosPageLoading title="Carregando o fechamento" description="Juntando contas, faturas, assinaturas e metas do mês." />;
    return desktop ? <DeskPage testId="budget-closing"><DeskHeader title={`Fechar ${name}`} month={month} setMonth={setMonth} />{loading}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={`Fechar ${name}`} subtitle="Passar o mês a limpo" month={month} setMonth={setMonth} />{loading}</div>;
  }

  // ---------- numbers ----------
  const invoicesTotal = r2(inst.invoices.reduce((s, i) => s + i.value, 0));
  const savedPlanned = r2(Object.values(planned.saving ?? {}).reduce((s, v) => s + v, 0));
  const savedReal = r2(goalRows.reduce((s, g) => s + Math.max(0, g.saved), 0));
  const rows: { label: string; plan: number | null; real: number; good: "up" | "down" }[] = [
    { label: "Entrou", plan: hasPlan ? planned.planned_income : null, real: c.earned, good: "up" },
    { label: "Contas e faturas", plan: hasPlan ? planned.planned_bills : null, real: r2(bills.paidTotal + invoicesTotal), good: "down" },
    { label: "Dia a dia", plan: c.dailyPlanned || null, real: c.dailySpent, good: "down" },
    { label: "Guardado", plan: savedPlanned || null, real: savedReal, good: "up" },
  ];
  const plannedLeft = hasPlan ? r2(planned.planned_income - planned.planned_bills - c.dailyPlanned - savedPlanned) : null;
  const lines = [...bills.lines, ...incomes.lines];
  const asPlanned = lines.filter((l) => l.paid && !(l.vsPlanned != null && Math.abs(l.vsPlanned) >= 0.01)).length;
  const otherValue = lines.filter((l) => l.paid && l.vsPlanned != null && Math.abs(l.vsPlanned) >= 0.01).length;
  const notHappened = lines.filter((l) => !l.paid).length;
  const realPts = view.projection.filter((p) => p.kind === "real");
  const lowest = realPts.reduce<(typeof realPts)[number] | null>((m, p) => (!m || p.value < m.value ? p : m), null);

  // Parcelas: what was already committed before the month against purchases made in it, and the months ahead.
  const instOld = r2(inst.lines.filter((l) => l.current > 1).reduce((s, l) => s + l.value, 0));
  const instNew = r2(inst.lines.filter((l) => l.current === 1).reduce((s, l) => s + l.value, 0));
  const ahead = [1, 2, 3, 4, 5, 6].map((k) => ({ m: addMonth(month, k), v: r2(inst.lines.filter((l) => l.left >= k).reduce((s, l) => s + l.value, 0)) }));
  const byCard = [...inst.invoices.reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + i.value), new Map<string, number>())];

  const cats = [...c.categories].filter((x) => x.spent > 0).sort((a, b) => b.over - a.over || b.spent - a.spent);
  const untouched = c.categories.filter((x) => x.spent <= 0 && x.limit > 0);
  const records = [...transactions].filter((t) => t.date.slice(0, 7) === month && !t.balance_adjustment)
    .filter((t) => recTab === "todos" || (recTab === "receitas" ? t.type === "receita" : recTab === "contas" ? t.type === "despesa" && (t.fixed || !!t.recurrence_id || t.invoice_payment) : t.type === "despesa" && !t.fixed && !t.recurrence_id && !t.invoice_payment))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastDay = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const newEntry = (kind: "Despesa" | "Receita") => openRegisterSheet({ kind, date: lastDay < today ? lastDay : today });

  // Next month in short (shown when closing): what is already known.
  const nextIncome = nextPlan.planned_income || c.earned;
  const nextBills = nextPlan.planned_bills || r2(bills.lines.reduce((s, l) => s + l.value, 0));
  const nextSave = r2(Object.values(nextPlan.saving ?? {}).reduce((s, v) => s + v, 0));
  const nextLeft = r2(nextIncome - nextBills - c.dailyPlanned - nextSave);

  // ---------- pieces ----------
  const lineRow = (l: BillLine, siblings: Transaction[]) => {
    const inc = l.tx.type === "receita";
    const diff = l.vsPlanned != null && Math.abs(l.vsPlanned) >= 0.01 ? l.vsPlanned : null;
    return (
      <li key={l.tx.id} className="py-3" data-testid={l.paid ? "closing-done-line" : "closing-open"}>
        <button type="button" onClick={() => dialogs.openTransactionDetail(l.tx, siblings)} className="flex w-full items-center gap-3 text-left">
          {l.paid ? <CheckCircle2 className="h-5 w-5 shrink-0 text-income" /> : <Circle className="h-5 w-5 shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{l.tx.name}</span>
            <span className="block text-xs text-muted-foreground">{dm(l.tx.date)} · {l.paid ? (inc ? "recebido" : "pago") : l.tx.status === "pendente" ? "estimativa, não aconteceu" : "agendado, não aconteceu"}</span>
            {diff != null ? <span className={cn("block text-xs font-medium", (diff > 0) === inc ? "text-income" : "text-expense")} data-testid="closing-vs-planned">{inc ? (diff < 0 ? "Recebi menos" : "Recebi a mais") : (diff > 0 ? "Paguei a mais" : "Paguei a menos")}: {money(Math.abs(diff))} (previsto {money(l.planned ?? 0)})</span> : null}
          </span>
          <strong className={cn("shrink-0 text-sm tabular-nums", inc && "text-income")}>{inc ? "+ " : ""}{money(l.value)}</strong>
        </button>
        {!l.paid ? (
          <div className="mt-2 grid grid-cols-3 gap-1.5 pl-8">
            <button type="button" onClick={() => dialogs.openTransactionDetail(l.tx, siblings)} className="h-9 rounded-full bg-primary text-xs font-bold text-primary-foreground">{inc ? "Recebi" : "Paguei"}</button>
            <button type="button" onClick={() => dialogs.openTransaction({ transaction: { ...l.tx, date: `${next}-${l.tx.date.slice(8)}` } })} className="h-9 rounded-full border border-border text-xs font-bold">Para {nextName}</button>
            <button type="button" onClick={() => dialogs.openTransactionDetail(l.tx, siblings)} className="h-9 rounded-full text-xs font-bold text-expense hover:bg-expense/10">{inc ? "Não caiu" : "Não vai ter"}</button>
          </div>
        ) : null}
      </li>
    );
  };

  const top = (
    <Block title={`O que aconteceu em ${name}`} testId="closing-top" note={hasPlan ? `Planejado ao começar ${name} × o que aconteceu de verdade.` : `Sem plano salvo para ${name}: o planejado aparece quando o mês começa pelo Orçamento.`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 gap-y-2.5 text-[13px]">
        <span /><span className="text-right text-[11px] text-muted-foreground">Planejado</span><span className="text-right text-[11px] text-muted-foreground">Realizado</span>
        {rows.map((r) => {
          const bad = r.plan != null && (r.good === "down" ? r.real > r.plan + 0.005 : r.real < r.plan - 0.005);
          return [
            <strong key={`${r.label}l`}>{r.label}</strong>,
            <span key={`${r.label}p`} className="text-right tabular-nums text-muted-foreground">{r.plan != null ? money(r.plan) : "—"}</span>,
            <strong key={`${r.label}r`} className={cn("text-right tabular-nums", bad ? "text-expense" : r.plan != null ? "text-income" : "")}>{money(r.real)}</strong>,
          ];
        })}
        <span className="col-span-3 my-0.5 h-px bg-border" />
        <strong className="text-sm">{c.result >= 0 ? "Sobrou" : "Faltou"}</strong>
        <span className="text-right tabular-nums text-muted-foreground">{plannedLeft != null ? money(plannedLeft) : "—"}</span>
        <strong className={cn("text-right font-heading text-base tabular-nums", c.result < 0 ? "text-expense" : "text-primary")} data-testid="closing-result">{money(Math.abs(c.result))}</strong>
      </div>
      {rows.some((r) => r.plan && r.good === "down") ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
          {rows.filter((r) => r.plan && r.good === "down").map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-xs"><span>{r.label}</span><span className={cn("font-semibold tabular-nums", r.real > r.plan! ? "text-expense" : "text-income")}>{r.real > r.plan! ? `passou ${money(r.real - r.plan!)}` : `sobrou ${money(r.plan! - r.real)}`}</span></div>
              <BulletBar className="mt-1.5" value={r.real} limit={r.plan!} format={money} />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">A marca é o planejado; o que passa dele fica vermelho.</p>
        </div>
      ) : null}
    </Block>
  );

  const charts = (
    <>
      <Block title="Saldo ao longo do mês" show={realPts.length >= 2}>
        <ProjectionLine width={desktop ? 520 : 320} height={desktop ? 140 : 110} area points={realPts.map((p) => ({ value: p.value, kind: "real" as const, label: dm(p.date) }))} format={money} ariaLabel={`Saldo de ${money(c.opening)} a ${money(c.closing)}`} />
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-muted-foreground"><span>Começou<strong className="block font-heading text-base text-foreground tabular-nums">{money(c.opening)}</strong></span><ArrowRight className="h-4 w-4" /><span className="text-right">Terminou<strong className="block font-heading text-base text-foreground tabular-nums">{money(c.closing)}</strong></span></div>
        <p className="mt-2 text-xs text-muted-foreground">{lowest ? <>Ponto mais baixo: <strong className={cn("tabular-nums", lowest.value < 0 ? "text-expense" : "text-foreground")}>{money(lowest.value)}</strong> em {dm(lowest.date)}. </> : null}{c.closing >= c.opening ? `Terminou ${money(c.closing - c.opening)} acima do começo.` : `Terminou ${money(c.opening - c.closing)} abaixo do começo.`}</p>
      </Block>
      <Block title="Para onde foi o dinheiro" show={view.slices.length > 0}>
        <div className="flex flex-col items-center gap-3">
          <Donut slices={view.slices} size={168} selectedId={slice} onSelect={setSlice} centerLabel="Total" format={money} />
          <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1 text-[13px]">{view.slices.map((s) => <li key={s.id}><button type="button" onClick={() => setSlice(slice === s.id ? null : s.id)} className={cn("flex w-full items-center gap-2 py-1 text-left", slice && slice !== s.id && "opacity-40")}><span className="h-2.5 w-2.5 shrink-0 rounded" style={{ backgroundColor: s.color }} /><span className="min-w-0 flex-1 truncate">{s.name}</span><span className="tabular-nums text-muted-foreground">{Math.round((s.value / Math.max(1, view.slices.reduce((t, x) => t + x.value, 0))) * 100)}%</span></button></li>)}</ul>
        </div>
      </Block>
      <Block title={`Gasto por dia em ${name}`} show={Object.keys(view.heat).length > 0} className={desktop ? "col-span-2" : ""}>
        <div className={desktop ? "mx-auto max-w-md" : undefined}><Heatmap month={month} values={view.heat} today={today} format={money} /></div>
      </Block>
    </>
  );

  const previstos = (
    <Block title="Contas e recebimentos previstos" id="fechar-contas" show={lines.length > 0} className={desktop ? "col-span-2" : ""} testId="closing-bills">
      <div className="grid grid-cols-3 gap-2">
        <span className="rounded-2xl bg-income/10 p-3 text-[11px] leading-tight text-income"><strong className="block font-heading text-xl">{asPlanned}</strong>como previsto</span>
        <span className="rounded-2xl bg-primary/[0.08] p-3 text-[11px] leading-tight text-primary"><strong className="block font-heading text-xl">{otherValue}</strong>valor diferente</span>
        <span className={cn("rounded-2xl p-3 text-[11px] leading-tight", notHappened ? "bg-expense/10 text-expense" : "bg-muted text-muted-foreground")}><strong className="block font-heading text-xl">{notHappened}</strong>não aconteceram</span>
      </div>
      {bills.lines.length ? <><p className="mt-4 text-xs font-semibold text-muted-foreground">Contas · {money(bills.paidTotal)} pagas</p><ul className="divide-y divide-border">{[...bills.open, ...bills.paid].map((l) => lineRow(l, bills.lines.map((x) => x.tx)))}</ul></> : null}
      {incomes.lines.length ? <><p className="mt-3 text-xs font-semibold text-muted-foreground">Recebimentos · {money(incomes.paidTotal)} recebidos</p><ul className="divide-y divide-border">{[...incomes.open, ...incomes.paid].map((l) => lineRow(l, incomes.lines.map((x) => x.tx)))}</ul></> : null}
    </Block>
  );

  const cards = (
    <>
      <Block title="Faturas pagas no mês" show={inst.invoices.length > 0} action={<Link to="/contas?aba=cartoes" className="text-xs font-semibold text-primary">Abrir Cartões</Link>} note={`${money(invoicesTotal)} em ${inst.invoices.length} ${inst.invoices.length === 1 ? "pagamento" : "pagamentos"} de fatura.`}>
        <Bars height={110} format={money} data={byCard.map(([n, v], i) => ({ label: n.replace(/^Pagamento( de)? fatura\s*/i, "").slice(0, 10) || n.slice(0, 10), value: v, focus: i === 0, valueLabel: money(v) }))} />
      </Block>
      <Block title="Parcelas" show={inst.lines.length > 0} testId="closing-installments"
        note={<>{money(inst.monthTotal)} em parcelas: <strong className="text-foreground">{money(instOld)}</strong> já estavam previstas{instNew ? <> e <strong className="text-expense">{money(instNew)}</strong> vieram de compras novas</> : null}.</>}>
        <SegmentedBar height={12} format={money} segments={[{ value: instOld, color: "#4B2CFF", label: "já previstas" }, ...(instNew ? [{ value: instNew, color: "#BE123C", label: "compras novas" }] : [])]} />
        <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#4B2CFF]" />já previstas</span>{instNew ? <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-expense" />compras novas</span> : null}</div>
        <p className="mb-1 mt-4 text-xs font-semibold">O que as parcelas já prendem nos próximos meses</p>
        <Bars height={110} format={money} data={ahead.map((a, i) => ({ label: MON[Number(a.m.slice(5)) - 1], value: a.v, focus: i === 0, valueLabel: a.v ? money(a.v).replace(/,\d\d$/, "") : "—" }))} />
        {inst.ending.length ? <p className="mt-3 rounded-xl bg-income/10 px-3 py-2 text-[13px] text-income">Terminaram em {name}: {inst.ending.map((l) => l.name).join(", ")}. Em {nextName} sobram {money(inst.ending.reduce((s, l) => s + l.value, 0))} a mais.</p> : null}
        <ul className="mt-3 divide-y divide-border">
          {inst.lines.slice(0, 5).map((l) => (
            <li key={l.key} className="py-2 text-[13px]" data-testid="closing-installment">
              <div className="flex justify-between gap-3"><span className="min-w-0 truncate font-medium">{l.name}</span><strong className="tabular-nums">{money(l.value)}</strong></div>
              <div className="mt-1 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(l.current / l.total) * 100}%` }} /></span><span className="whitespace-nowrap text-[11px] text-muted-foreground">{l.current}/{l.total}{l.left ? ` · faltam ${money(l.remaining)}` : " · última"}</span></div>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );

  const assinaturas = (
    <Block title="Assinaturas" show={subsReview.lines.length > 0} action={<Link to="/assinaturas" className="text-xs font-semibold text-primary">Abrir Assinaturas</Link>} note={`${money(subsReview.monthly)} por mês · ${money(subsReview.yearly)} por ano.`}>
      <SegmentedBar height={12} format={money} segments={subsReview.lines.map((s, i) => ({ value: s.recurrence === "anual" ? s.value / 12 : s.value, color: ["#4B2CFF", "#8058FF", "#B3A6FF", "#F59E0B", "#10B981", "#0EA5E9"][i % 6], label: s.name }))} />
      <ul className="mt-3 divide-y divide-border">
        {subsReview.lines.map((sItem) => {
          const rid = `cancelar:${sItem.id}`, marked = hasReminder(rid);
          return (
            <li key={sItem.id} className="flex items-center gap-3 py-2.5 text-sm" data-testid="closing-subscription">
              <Link to={`/assinaturas?assinatura=${sItem.id}`} className="min-w-0 flex-1"><span className="block truncate font-medium">{sItem.name} · <span className="tabular-nums">{money(sItem.value)}</span></span><span className="text-xs text-muted-foreground">próxima {dm(sItem.next)} · {sItem.where}</span></Link>
              <button type="button" onClick={() => toggleReminder({ id: rid, date: sItem.cancelBy, text: `Cancelar ${sItem.name} antes da cobrança de ${dm(sItem.next)}`, kind: "assinatura" })} className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold", marked ? "bg-primary text-primary-foreground" : "border border-border")}><Bell className="h-3.5 w-3.5" />{marked ? dm(sItem.cancelBy) : "Cancelar"}</button>
            </li>
          );
        })}
      </ul>
    </Block>
  );

  const metas = (
    <Block title="Metas" show={goalRows.length > 0} action={<Link to="/metas" className="text-xs font-semibold text-primary">Abrir Metas</Link>}>
      <ul className="flex flex-col gap-3.5">
        {goalRows.map((g) => (
          <li key={g.id} data-testid="closing-goal">
            <div className="flex justify-between gap-3 text-sm"><Link to={`/metas?meta=${g.id}`} className="font-medium hover:underline">{g.name}</Link><span className={cn("tabular-nums text-xs font-semibold", g.diff < 0 ? "text-amber-700 dark:text-amber-400" : "text-income")}>{g.planned ? (g.diff < 0 ? `faltou ${money(-g.diff)}` : g.diff > 0 ? `${money(g.diff)} a mais` : "como planejado") : `guardou ${money(g.saved)}`}</span></div>
            <BulletBar className="mt-1.5" value={Math.max(0, g.planned ? g.saved : g.total)} limit={g.planned || g.target} format={money} />
            <p className="mt-1 text-xs text-muted-foreground">{g.planned ? `Planejado ${money(g.planned)} · guardado ${money(g.saved)} · ` : ""}na meta: {money(g.total)} de {money(g.target)}</p>
          </li>
        ))}
      </ul>
    </Block>
  );

  const categorias = (
    <Block title="Por categoria" id="fechar-categorias" show={cats.length > 0} className={desktop ? "col-span-2" : ""} action={<span className="text-[11px] text-muted-foreground">gasto · limite · média</span>}>
      <ul className={cn("grid gap-x-6 gap-y-3", desktop && "grid-cols-2")}>
        {cats.map((x) => {
          const avg = avgBy.get(x.category_id);
          const over = div.over.find((o) => o.category_id === x.category_id);
          return (
            <li key={x.category_id} className="border-t border-border pt-2.5 first:border-0 first:pt-0">
              <Link to={`/orcamento/gastos?mes=${month}&categoria=${x.category_id}`} className="flex justify-between gap-2 text-[13px]"><strong>{x.name}</strong><span className={cn("tabular-nums", x.over > 0 ? "font-semibold text-expense" : "text-muted-foreground")}>{money(x.spent)} de {money(x.limit)}</span></Link>
              <BulletBar className="mt-1.5" value={x.spent} limit={x.limit} striped={x.benefit} stripedLabel="com VR/VA" format={money} />
              <div className="mt-1 flex justify-between gap-2 text-[11px]">
                <span className={x.over > 0 ? "font-semibold text-expense" : "text-income"}>{x.over > 0 ? `passou ${money(x.over)}` : `sobrou ${money(Math.max(0, x.limit - x.spent))}`}</span>
                <span className="text-muted-foreground">{[avg ? `média ${money(avg)}` : null, x.previous ? `${x.spent >= x.previous ? "+" : "−"}${money(Math.abs(x.spent - x.previous))} vs ${MON[Number(addMonth(month, -1).slice(5)) - 1]}` : null].filter(Boolean).join(" · ")}</span>
              </div>
              {over?.top.length ? <ul className="mt-1 text-xs text-muted-foreground">{over.top.map((t) => <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, over.top)} className="flex w-full justify-between gap-2 py-0.5 text-left hover:text-foreground"><span className="truncate">{t.name} · {dm(t.date)}</span><span className="tabular-nums">{money(amountOf(t))}</span></button></li>)}</ul> : null}
            </li>
          );
        })}
      </ul>
      {untouched.length ? <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">Sem gasto em {name}: {untouched.map((x) => x.name).join(", ")}.</p> : null}
    </Block>
  );

  const divergiu = (
    <>
      <Block title="Contas que subiram" show={div.priceUps.length > 0}>
        <ul className="divide-y divide-border text-sm">{div.priceUps.map((l) => <li key={l.tx.id}><button type="button" onClick={() => dialogs.openTransactionDetail(l.tx)} className="flex w-full justify-between gap-3 py-2 text-left"><span>{l.tx.name}<span className="block text-xs text-muted-foreground">{money(l.previous ?? 0)} → {money(l.value)}</span></span><strong className="tabular-nums text-expense">+{money(l.delta ?? 0)}</strong></button></li>)}</ul>
      </Block>
      <Block title="Pode estar repetido" show={div.dups.length > 0}>
        <ul className="divide-y divide-border text-sm">{div.dups.map((d) => <li key={`${d.a.id}-${d.b.id}`} className="flex items-center justify-between gap-3 py-2"><span>{d.a.name}<span className="block text-xs text-muted-foreground">{money(d.a.value)} em {dm(d.a.date)} e {dm(d.b.date)}</span></span><button type="button" className="h-8 rounded-full border border-border px-3 text-xs font-bold" onClick={() => dialogs.openTransactionDetail(d.b, [d.a, d.b])}>Conferir</button></li>)}</ul>
      </Block>
      <Block title="Fora do previsto" show={c.unplanned.length > 0} note="Os maiores gastos que não eram contas fixas nem parcelas.">
        <ul className="flex flex-col gap-2.5 text-[13px]">
          {c.unplanned.slice(0, 6).map((t) => (
            <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, c.unplanned)} className="w-full text-left">
              <span className="flex justify-between gap-3"><span className="min-w-0 truncate font-medium">{t.name}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{dm(t.date)} · {t.category_name ?? "Sem categoria"}</span></span><strong className="tabular-nums">{money(amountOf(t))}</strong></span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${(amountOf(t) / amountOf(c.unplanned[0])) * 100}%` }} /></span>
            </button></li>
          ))}
        </ul>
      </Block>
    </>
  );

  const registrado = (
    <Block title="Tudo o que foi registrado" id="fechar-registros" className={desktop ? "col-span-2" : ""} testId="closing-records" note={`Faltou algo ou está errado? Toque para abrir no registro, ou lance o que falta. O resultado de ${name} muda na hora.`}>
      <div role="tablist" aria-label="Filtrar lançamentos" className="grid grid-cols-4 gap-1 rounded-full bg-muted p-1">
        {([["todos", "Todos"], ["contas", "Contas"], ["receitas", "Receitas"], ["gastos", "Gastos"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={recTab === k} onClick={() => { setRecTab(k); setRecAll(false); }} className={cn("h-8 rounded-full text-xs font-semibold", recTab === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>{l}</button>)}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {(recAll ? records : records.slice(0, 8)).map((t) => (
          <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, records)} className="flex w-full items-center gap-3 py-2.5 text-left">
            <span className="grid h-11 w-10 shrink-0 place-content-center rounded-xl bg-muted text-center"><strong className="font-heading text-sm leading-none">{t.date.slice(8)}</strong><span className="text-[10px] text-muted-foreground">{MON[Number(t.date.slice(5, 7)) - 1]}</span></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.name}</span><span className="block truncate text-xs text-muted-foreground">{t.type === "transferencia" ? `${t.account_name} → ${t.to_account_name ?? ""}` : `${t.category_name ?? "Sem categoria"} · ${t.card_name ?? t.account_name}`}{t.status !== "pago" ? " · em aberto" : ""}</span></span>
            <strong className={cn("shrink-0 text-sm tabular-nums", t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "")}>{t.type === "receita" ? "+" : t.type === "despesa" ? "−" : ""}{money(amountOf(t))}</strong>
          </button></li>
        ))}
        {!records.length ? <li className="py-3 text-sm text-muted-foreground">Nada aqui em {name}.</li> : null}
      </ul>
      {records.length > 8 ? <button type="button" onClick={() => setRecAll((a) => !a)} className="mt-1 text-[13px] font-semibold text-primary">{recAll ? "Mostrar menos" : `Ver mais ${records.length - 8}`}</button> : null}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => newEntry("Despesa")} className="flex h-10 items-center justify-center gap-1 rounded-full bg-primary text-xs font-bold text-primary-foreground"><Plus className="h-3.5 w-3.5" />Conta</button>
        <button type="button" onClick={() => newEntry("Receita")} className="flex h-10 items-center justify-center gap-1 rounded-full border border-border text-xs font-bold"><Plus className="h-3.5 w-3.5" />Receita</button>
        <button type="button" onClick={() => newEntry("Despesa")} className="flex h-10 items-center justify-center gap-1 rounded-full border border-border text-xs font-bold"><Plus className="h-3.5 w-3.5" />Gasto</button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Salvo no Fluxo, com a data de {name}. Fatura e meta se alteram em Cartões e em Metas.</p>
    </Block>
  );

  const analise = (
    <div className={cn("flex min-w-0 flex-col gap-3", desktop && "col-span-2")} id="fechar-analise">
      <section className="rounded-[20px] border border-primary/20 bg-primary/5 p-4 sm:p-5" data-testid="closing-fiint">
        <p className="flex items-center gap-2 font-heading text-[15px] font-semibold"><Sparkles className="h-4 w-4 text-primary" /> FIINT sobre {name}</p>
        <p className="mt-2 text-[13px] leading-relaxed">Você fechou {name} com <strong>{c.result >= 0 ? `${money(c.result)} de sobra` : `${money(-c.result)} a menos`}</strong>. {c.categories.filter((x) => x.over > 0).length ? `${c.categories.filter((x) => x.over > 0).map((x) => x.name).join(", ")} passou do limite.` : "Todas as categorias ficaram dentro do limite."} {notHappened ? `${notHappened} ${notHappened === 1 ? "previsto não aconteceu" : "previstos não aconteceram"}.` : "Todo o previsto aconteceu."}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{c.insights.map((i) => <button key={i.id} type="button" onClick={() => setQ(q === i.id ? null : i.id)} className={cn("h-8 rounded-full px-3 text-xs font-semibold", q === i.id ? "bg-primary text-primary-foreground" : "border border-border bg-card")}>{i.question}</button>)}</div>
        {q ? (() => { const i = c.insights.find((x) => x.id === q)!; return <div className="mt-3 rounded-xl bg-card p-3 text-[13px]"><p>{i.answer}</p>{i.items.length ? <ul className="mt-2 divide-y divide-border">{i.items.map((t) => <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, i.items)} className="flex w-full justify-between py-1.5 text-left"><span>{t.name}<span className="ml-2 text-xs text-muted-foreground">{dm(t.date)}</span></span><span className="tabular-nums">{money(amountOf(t))}</span></button></li>)}</ul> : null}<p className="mt-2 text-[11px] text-muted-foreground">A FIINT só lê os seus lançamentos. Nada é alterado.</p></div>; })() : null}
      </section>
      <div className={cn("grid gap-3 [&>*:nth-child(n+4)]:hidden", desktop ? "grid-cols-3" : "grid-cols-1")} data-testid="closing-analyses">
        {ANALYSES.map((id) => <CatalogInsight key={id} id={id} size="M" month={month} to={detailPath(id, { month })} className="min-h-[170px]" hideEmpty />)}
      </div>
    </div>
  );

  const sobraBlock = record ? null : (
    <Block title={`Para onde vai a sobra`} id="fechar-sobra" className={desktop ? "col-span-2" : ""} note="Divida entre outras contas, metas (a reserva de emergência também é uma meta) e investimentos. O que não for distribuído fica na conta.">
      <SobraPlanner sobra={notOver ? 0 : sobra} monthName={name} accounts={accounts} goals={goals} mainAccount={mainAccount} money={money} allocs={allocs} setAllocs={setAllocs} />
      <label className="mt-4 grid gap-1.5 text-[13px] font-semibold">Observação do mês <span className="text-xs font-normal text-muted-foreground">Opcional. Fica no histórico.</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="Ex.: o aniversário da Ana pesou em Restaurantes." className="rounded-xl border border-input bg-background px-3 py-2 text-sm font-normal" data-testid="closing-note" />
      </label>
    </Block>
  );

  const done = record ? (
    <Block title={`${monthLabel(month)} fechado`} testId="closing-done" note={`Fechado em ${dm(record.closed_at.slice(0, 10))}. O retrato do mês fica guardado na sua conta e aparece em todos os aparelhos.`} className={desktop ? "col-span-2" : ""}>
      {record.allocation.length ? (
        <ul className="divide-y divide-border">
          {record.allocation.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="min-w-0"><strong className="block truncate">{a.name}</strong><span className="text-xs text-muted-foreground">{a.kind === "meta" ? "Meta" : a.kind === "investimento" ? "Investimento" : "Transferência"}</span></span>
              <span className="flex items-center gap-2"><strong className="tabular-nums">{money(a.value)}</strong>{a.done ? <Check className="h-4 w-4 text-income" aria-label="Registrado" /> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={`/orcamento/novo?mes=${next}`} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="closing-new-period">Começar {nextName} <ArrowRight className="h-4 w-4" /></Link>
        <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> PDF</button>
        <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold" onClick={share}><Share2 className="h-3.5 w-3.5" /> Enviar</button>
        <button type="button" className="inline-flex h-10 items-center rounded-full px-3 text-xs font-semibold text-muted-foreground" onClick={() => closings.reopen.mutate(month)}>Reabrir</button>
      </div>
    </Block>
  ) : null;

  // Close: every destination of the sobra registered first, then the summary.
  const blockedBy = notOver ? "O mês ainda não terminou" : overAlloc ? "Os destinos passam da sobra" : pendingAllocs.length ? `Registre ${pendingAllocs.length === 1 ? "o destino" : `os ${pendingAllocs.length} destinos`} da sobra` : null;
  const closeButton = record ? null : (
    <button type="button" disabled={notOver} onClick={() => (blockedBy && !notOver ? scrollTo("fechar-sobra") : setSheet(true))} className={cn("flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50", blockedBy ? "border border-primary/40 bg-card text-primary" : "bg-primary text-primary-foreground")} data-testid="closing-open-sheet">
      <Lock className="h-5 w-5" /> {blockedBy ?? `Fechar ${name}`}
    </button>
  );

  const pending: [string, number, string][] = [
    ["Previstos que não aconteceram", notHappened, "fechar-contas"],
    ["Categorias que passaram do limite", div.over.length, "fechar-categorias"],
    ["Possíveis repetidos", div.dups.length, "fechar-registros"],
  ];
  const sumRow = (k: string, v: React.ReactNode, cls?: string) => <div className="flex items-baseline justify-between gap-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className={cn("text-right font-semibold tabular-nums", cls)}>{v}</dd></div>;
  const sheetEl = (
    <Sheet open={sheet} onOpenChange={setSheet}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 overflow-y-auto p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92svh] rounded-t-3xl")} data-testid="closing-sheet">
        <div className="pb-1 pl-16 pr-5 pt-5"><SheetTitle className="font-heading text-xl leading-9">Resumo de {name}</SheetTitle></div>
        <div className="flex flex-col gap-3 px-5 pb-4 pt-3" data-testid="closing-summary">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Entrou", money(c.earned), "text-income"], ["Saiu", money(c.spent), ""], [c.result >= 0 ? "Sobrou" : "Faltou", money(Math.abs(c.result)), c.result >= 0 ? "text-primary" : "text-expense"]].map(([k, v, cl]) => (
              <div key={k} className="min-w-0 rounded-2xl bg-muted/60 px-2 py-2.5"><p className="text-[11px] text-muted-foreground">{k}</p><p className={cn("truncate font-heading text-[15px] font-bold tabular-nums", cl)}>{v}</p></div>
            ))}
          </div>
          <dl className="divide-y divide-border rounded-2xl border border-border px-4 text-[13px]">
            {sumRow("Contas pagas", `${bills.paid.length} de ${bills.lines.length}`)}
            {incomes.lines.length ? sumRow("Recebimentos", `${incomes.paid.length} de ${incomes.lines.length}`) : null}
            {c.dailyPlanned ? sumRow("Dia a dia", `${money(c.dailySpent)} de ${money(c.dailyPlanned)}`, c.dailySpent > c.dailyPlanned ? "text-expense" : "") : null}
            {inst.lines.length ? sumRow("Parcelas a pagar", money(inst.future)) : null}
            {allocs.filter((a) => a.value > 0).map((a) => <div key={a.id}>{sumRow(a.name, <span className="inline-flex items-center gap-1">{money(a.value)}{a.done ? <Check className="h-3.5 w-3.5 text-income" /> : null}</span>)}</div>)}
            {reminders.length ? sumRow(`Lembretes para ${nextName}`, reminders.length) : null}
          </dl>
          {note.trim() ? <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px]">“{note.trim()}”</p> : null}
          {pending.some(([, n]) => n) ? (
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="closing-pending">
              <p className="font-semibold">Ficou em aberto</p>
              <ul className="mt-1">{pending.filter(([, n]) => n).map(([k, n, id]) => <li key={k} className="flex items-center justify-between gap-2 py-1"><span>{k}: {n}</span><button type="button" onClick={() => scrollTo(id)} className="h-7 shrink-0 rounded-full bg-amber-500/15 px-3 text-xs font-bold">Ver</button></li>)}</ul>
              <p className="mt-1 text-xs">O que ficar aberto continua no Fluxo.</p>
            </div>
          ) : <p className="flex items-center gap-2 text-[13px] font-medium text-income"><CheckCircle2 className="h-4 w-4" /> Tudo conferido.</p>}
          <div className="rounded-2xl border border-border px-4 py-3 text-[13px]" data-testid="closing-next">
            <p className={lbl}>A conta de {nextName}</p>
            <dl className="mt-1">
              {sumRow("Receitas", `+ ${money(nextIncome)}`, "text-income")}
              {sumRow("Contas", `− ${money(nextBills)}`)}
              {nextSave ? sumRow("Guardar", `− ${money(nextSave)}`) : null}
              {sumRow("Dia a dia (limites)", `− ${money(c.dailyPlanned)}`)}
            </dl>
            <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2"><strong>Sobra prevista</strong><strong className={cn("font-heading text-lg tabular-nums", nextLeft < 0 ? "text-expense" : "text-income")}>{money(nextLeft)}</strong></div>
            <p className="mt-1 text-[11px] text-muted-foreground">{nextPlan.planned_income ? `Do plano de ${nextName}.` : `Estimativa com os números de ${name}; você ajusta ao começar ${nextName}.`}</p>
          </div>
        </div>
        <div className="sticky bottom-0 border-t border-border bg-popover px-5 py-4">
          <button type="button" className="h-14 w-full rounded-full bg-primary text-base font-bold text-primary-foreground disabled:opacity-50" onClick={close} disabled={closings.close.isPending} data-testid="closing-confirm">{closings.close.isPending ? "Fechando…" : `Fechar ${name}`}</button>
        </div>
      </SheetContent>
    </Sheet>
  );
  const successEl = success ? (
    <BudgetSuccess title={`${monthLabel(month).split(" ")[0]} fechado`} amountLabel={c.result >= 0 ? "Sobrou no mês" : "Faltou no mês"} amount={money(Math.abs(c.result))}
      chips={[`Entrou ${money(c.earned)}`, `Saiu ${money(c.spent)}`, ...(record?.allocation ?? []).filter((a) => a.value > 0).map((a) => `${a.name} ${money(a.value)}`), ...(reminders.length ? [`${reminders.length} lembretes`] : [])]}
      action="Ir para o Orçamento" onDone={() => navigate(`/orcamento?mes=${next}`, { replace: true })} />
  ) : null;

  const body = (
    <div className={cn("grid items-start gap-4", desktop ? "grid-cols-2" : "grid-cols-1")}>
      {done}
      <div className={desktop ? "col-span-2" : ""}>{top}</div>
      {charts}
      {previstos}
      {cards}
      {assinaturas}
      {metas}
      {categorias}
      {divergiu}
      {registrado}
      {analise}
      {sobraBlock}
    </div>
  );

  if (desktop) return (
    <DeskPage testId="budget-closing">
      <DeskHeader title={`Fechar ${name}`} subtitle="Passar o mês a limpo" month={month} setMonth={setMonth} />
      {body}
      {closeButton ? <div className="mx-auto w-full max-w-md">{closeButton}</div> : null}
      {sheetEl}{successEl}
    </DeskPage>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 pb-6 animate-fade-up" data-testid="budget-closing">
      <BudgetHeader title={`Fechar ${name}`} subtitle="Passar o mês a limpo" month={month} setMonth={setMonth} />
      {body}
      {closeButton}
      {sheetEl}{successEl}
    </div>
  );
}
