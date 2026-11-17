/**
 * Orçamento · Fechar o mês. O momento de sentar e passar o mês a limpo, numa página só:
 * contas, recebimentos, cartões e parcelas, assinaturas, metas, o que divergiu e a análise do mês. No fim, "Fechar"
 * abre o destino da sobra, a observação e o resumo; ao confirmar, a animação de concluído e volta ao Orçamento.
 * Tudo vem dos módulos de origem; cada ação abre o registro onde ele vive (Fluxo, Cartões, Assinaturas, Metas).
 * O Orçamento guarda só o retrato do fechamento (e, se você pedir, lembretes no plano do mês seguinte).
 */
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, ChevronDown, Circle, Lock, Printer, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { fetchBudget, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { buildClosing } from "@/lib/budget/closing";
import { divergences, reviewBills, reviewGoals, reviewInstallments, reviewSubscriptions, type BillLine } from "@/lib/budget/review";
import type { BudgetClosing as Closing, PlanReminder } from "@/lib/budget/server";
import { detailPath } from "@/lib/insights/registry";
import { useBudgetClosings, useBudgetPlans } from "@/components/budget/usePlans";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BulletBar, Donut, Heatmap, ProjectionLine } from "@/components/charts/FinnosCharts";
import { CatalogInsight } from "@/components/insights/CatalogInsight";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, dm, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { DeskHeader, DeskPage, Panel, useIsDesktop } from "@/components/budget/desktop/kit";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BudgetSuccess } from "@/components/budget/BudgetSuccess";
import { cn } from "@/lib/utils";

type StepId = "contas" | "recebimentos" | "cartoes" | "assinaturas" | "metas" | "divergiu" | "analise";
type Alloc = Closing["allocation"][number];
// The analyses of the library read for the month being closed (the same ones Análise shows for that month).
const ANALYSES = ["maiores-gastos", "categorias-subiram", "fixo-x-variavel", "taxa-poupanca", "onde-compra", "fim-de-semana", "efeito-salario", "juros-e-tarifas"];

function Section({ title, hint, children, className, action }: { title: string; hint?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return <Panel title={title} action={action} className={className}>{hint ? <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">{hint}</p> : null}{children}</Panel>;
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
  const prevBudget = useQuery({ queryKey: ["budget", addMonth(month, -1)], queryFn: () => fetchBudget(addMonth(month, -1)) });
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
  const [alloc, setAlloc] = useState<Alloc[]>([]);
  const [note, setNote] = useState("");
  const [q, setQ] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [slice, setSlice] = useState<string | null>(null);
  useEffect(() => { setAlloc([]); setNote(""); setSheet(false); }, [month]);
  const go = (id: StepId) => { setSheet(false); requestAnimationFrame(() => document.getElementById(`fechar-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  const c = useMemo(() => {
    if (!view) return null;
    const opening = view.projection.find((p) => p.kind === "real")?.value ?? 0;
    const closingBal = [...view.projection].reverse().find((p) => p.kind === "real")?.value ?? view.inAccounts;
    return buildClosing({ month, transactions, categories: view.categories, previous: Object.fromEntries((prevBudget.data?.rows ?? []).map((r) => [r.category_id, r.spent])), earned: view.earned, spent: view.spent, opening, closing: closingBal });
  }, [view, month, transactions, prevBudget.data]);
  const expected = planned.expected;
  const bills = useMemo(() => reviewBills(month, transactions, prevTxs, "despesa", expected ?? {}), [month, transactions, prevTxs, expected]);
  const incomes = useMemo(() => reviewBills(month, transactions, prevTxs, "receita", expected ?? {}), [month, transactions, prevTxs, expected]);
  const inst = useMemo(() => reviewInstallments(month, transactions), [month, transactions]);
  const subsReview = useMemo(() => reviewSubscriptions(subs.data?.items ?? [], today), [subs.data, today]);
  const goalRows = useMemo(() => reviewGoals(month, goals, planned.saving ?? {}), [month, goals, planned.saving]);
  const div = useMemo(() => (view ? divergences(month, transactions, prevTxs, view.categories) : null), [view, month, transactions, prevTxs]);

  // Reminders the person asks for while closing go to next month's plan (shown in the Orçamento on the day).
  const reminders = nextPlan.reminders ?? [];
  const hasReminder = (id: string) => reminders.some((r) => r.id === id);
  const toggleReminder = (r: PlanReminder) => {
    const list = hasReminder(r.id) ? reminders.filter((x) => x.id !== r.id) : [...reminders, r];
    plans.save.mutate({ ...nextPlan, reminders: list }, { onSuccess: () => toast.success(hasReminder(r.id) ? "Lembrete tirado." : `Lembrete para ${dm(r.date)} em ${nextName}.`) });
  };

  const notOver = month >= currentMonth();
  const sobra = Math.max(0, c?.result ?? 0);
  const used = alloc.reduce((s, a) => s + a.value, 0);
  const rest = Math.round((sobra - used) * 100) / 100;
  const mainAccount = accounts.find((a) => a.active && a.type !== "beneficio" && a.is_default) ?? accounts.find((a) => a.active && a.type !== "beneficio");
  const addAlloc = (a: Omit<Alloc, "value">) => setAlloc((cur) => (cur.some((x) => x.id === a.id) ? cur : [...cur, { ...a, value: Math.min(50, Math.max(0, rest)) }]));
  const stepAlloc = (id: string, d: number) => setAlloc((cur) => cur.map((x) => (x.id === id ? { ...x, value: Math.max(0, Math.min(x.value + d, x.value + Math.max(0, rest))) } : x)));

  const close = () => {
    if (!c || !view) return;
    const rec: Closing = { month, closed_at: new Date().toISOString(), earned: c.earned, spent: c.spent, result: c.result, daily_planned: c.dailyPlanned, daily_spent: c.dailySpent,
      planned_income: hasPlan ? planned.planned_income : null, planned_bills: hasPlan ? planned.planned_bills : null, allocation: alloc.filter((a) => a.value > 0),
      categories: c.categories.map((x) => ({ category_id: x.category_id, name: x.name, spent: x.spent, limit: x.limit })), note: note.trim() || null,
      estimates: [...bills.lines, ...incomes.lines].slice(0, 300).map((l) => ({ name: l.tx.name.slice(0, 120), type: l.tx.type as "receita" | "despesa", value: l.value, outcome: l.paid ? "aconteceu" as const : "aberto" as const })) };
    closings.close.mutate(rec, { onSuccess: () => { setSheet(false); setSuccess(true); } });
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

  // What still needs an answer in each part (shown in the step list and before closing).
  const pendingOf: Record<StepId, number> = {
    contas: bills.open.length, recebimentos: incomes.open.length, cartoes: 0, assinaturas: 0, metas: goalRows.filter((g) => g.diff < 0).length,
    divergiu: div.over.length + div.dups.length, analise: 0,
  };
  const LABEL: Record<StepId, string> = { contas: "Contas", recebimentos: "Recebimentos", cartoes: "Cartões e parcelas", assinaturas: "Assinaturas", metas: "Metas", divergiu: "O que divergiu", analise: "Análise" };

  // ---------- small pieces ----------
  // Against the plan first (what was expected when the month was planned), else against the month before.
  const delta = (l: BillLine) => l.vsPlanned != null && Math.abs(l.vsPlanned) >= 0.01 ? (
    <span className={cn("text-xs font-medium", (l.vsPlanned > 0) === (l.tx.type === "receita") ? "text-income" : "text-expense")} data-testid="closing-vs-planned">
      {l.tx.type === "receita" ? (l.vsPlanned < 0 ? "recebi menos" : "recebi a mais") : (l.vsPlanned > 0 ? "paguei a mais" : "paguei a menos")}: {money(Math.abs(l.vsPlanned))} {l.vsPlanned > 0 ? "acima" : "abaixo"} do previsto ({money(l.planned ?? 0)})
    </span>
  ) : (l.delta != null && Math.abs(l.delta) >= 0.01 ? <span className={cn("text-xs", l.delta > 0 ? (l.tx.type === "receita" ? "text-income" : "text-expense") : l.tx.type === "receita" ? "text-expense" : "text-income")}>{l.delta > 0 ? "+" : "−"}{money(Math.abs(l.delta))} vs mês anterior</span> : null);
  const lineList = (lines: BillLine[], kind: "despesa" | "receita") => (
    <ul className="divide-y divide-border">
      {lines.map((l) => (
        <li key={l.tx.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-testid={l.paid ? "closing-done-line" : "closing-open"}>
          {l.paid ? <CheckCircle2 className="h-5 w-5 shrink-0 text-income" /> : <Circle className="h-5 w-5 shrink-0 text-amber-500" />}
          <button type="button" onClick={() => dialogs.openTransactionDetail(l.tx, lines.map((x) => x.tx))} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">{l.tx.name}</span>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground"><span>{dm(l.tx.date)} · {l.paid ? (kind === "receita" ? "recebido" : "pago") : l.tx.status === "pendente" ? "estimativa, não aconteceu" : "agendado, não aconteceu"}</span>{delta(l)}</span>
          </button>
          <strong className={cn("text-sm tabular-nums", kind === "receita" && "text-income")}>{kind === "receita" ? "+ " : ""}{money(l.value)}</strong>
          {!l.paid ? (
            <span className="flex w-full gap-1.5 pl-8 sm:w-auto sm:pl-0">
              <Button size="sm" className="h-8 rounded-full" onClick={() => dialogs.openTransaction({ transaction: { ...l.tx, status: "pago" } })}>{kind === "receita" ? "Recebi" : "Paguei"}</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => dialogs.openTransaction({ transaction: { ...l.tx, date: `${next}-${l.tx.date.slice(8)}` } })}>Para {nextName}</Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-full text-expense" onClick={() => dialogs.openTransactionDetail(l.tx, lines.map((x) => x.tx))}>{kind === "receita" ? "Não caiu" : "Não vai acontecer"}</Button>
            </span>
          ) : null}
        </li>
      ))}
      {!lines.length ? <li className="py-3 text-sm text-muted-foreground">Nada previsto aqui em {name}.</li> : null}
    </ul>
  );
  const status = (n: number, ok: string, bad: string) => <p className={cn("mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium", n ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-income/10 text-income")}>{n ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{n ? bad : ok}</p>;

  // ---------- the parts ----------
  const parts: Record<StepId | "fechar", React.ReactNode> = {
    contas: (
      <Section title={`Contas de ${name}`} hint="Cada conta prevista: foi paga? Pelo valor de sempre? O que não aconteceu você resolve aqui, no próprio lançamento do Fluxo.">
        {status(bills.open.length, `Todas as ${bills.paid.length} contas foram pagas (${money(bills.paidTotal)}).`, `${bills.open.length} ${bills.open.length === 1 ? "conta não foi paga" : "contas não foram pagas"}: decida o que fazer com cada uma.`)}
        {bills.changed.length ? <p className="mb-2 text-xs text-muted-foreground">{bills.changed.length} {bills.changed.length === 1 ? "conta veio" : "contas vieram"} com valor diferente do previsto ou do mês anterior.</p> : null}
        {lineList(bills.lines, "despesa")}
      </Section>
    ),
    recebimentos: (
      <Section title={`Recebimentos de ${name}`} hint="O que estava previsto entrar: caiu tudo? Pelo valor certo?">
        {status(incomes.open.length, `Tudo o que era esperado entrou (${money(incomes.paidTotal)}).`, `${incomes.open.length} ${incomes.open.length === 1 ? "recebimento não caiu" : "recebimentos não caíram"}.`)}
        {incomes.paid.some((l) => (l.vsPlanned ?? 0) < 0) ? <p className="mb-2 text-xs font-medium text-expense">Recebeu menos que o previsto em {incomes.paid.filter((l) => (l.vsPlanned ?? 0) < 0).map((l) => l.tx.name).join(", ")}: {money(-incomes.paid.reduce((s, l) => s + Math.min(0, l.vsPlanned ?? 0), 0))} a menos.</p> : null}
        {lineList(incomes.lines, "receita")}
      </Section>
    ),
    cartoes: (
      <div className="flex flex-col gap-4">
        <Section title="Faturas pagas no mês">
          {inst.invoices.length ? <ul className="divide-y divide-border text-sm">{inst.invoices.map((i) => <li key={i.id} className="flex justify-between gap-3 py-2"><span><CheckCircle2 className="mr-2 inline h-4 w-4 text-income" />{i.name}<span className="ml-2 text-xs text-muted-foreground">{dm(i.date)}</span></span><strong className="tabular-nums">{money(i.value)}</strong></li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhum pagamento de fatura registrado em {name}.</p>}
          <Link to="/contas?aba=cartoes" className="mt-2 inline-block text-[13px] font-semibold text-primary">Abrir Cartões</Link>
        </Section>
        <Section title="Parcelas" hint={inst.lines.length ? `${money(inst.monthTotal)} em parcelas neste mês. Ainda faltam ${money(inst.future)}${inst.lastEnd > month ? `, a última em ${monthLabel(inst.lastEnd).toLowerCase()}` : ""}.` : undefined}>
          {inst.lines.length ? (
            <ul className="divide-y divide-border">
              {inst.lines.map((l) => (
                <li key={l.key} className="py-2.5 text-sm" data-testid="closing-installment">
                  <div className="flex justify-between gap-3"><span className="min-w-0"><span className="block truncate font-medium">{l.name}</span><span className="text-xs text-muted-foreground">{l.card} · parcela {l.current} de {l.total}</span></span><strong className="tabular-nums">{money(l.value)}</strong></div>
                  <div className="mt-1.5 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(l.current / l.total) * 100}%` }} /></span><span className="whitespace-nowrap text-xs text-muted-foreground">{l.left ? `faltam ${l.left} · ${money(l.remaining)} · até ${monthLabel(l.ends).split(" ")[0].slice(0, 3)}/${l.ends.slice(2, 4)}` : "última parcela"}</span></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nenhuma compra parcelada em {name}.</p>}
          {inst.ending.length ? <p className="mt-3 rounded-xl bg-income/10 px-3 py-2 text-[13px] text-income">Terminaram em {name}: {inst.ending.map((l) => l.name).join(", ")}. Em {nextName} sobram {money(inst.ending.reduce((s, l) => s + l.value, 0))} a mais.</p> : null}
        </Section>
      </div>
    ),
    assinaturas: (
      <Section title="Assinaturas ativas" hint={`${money(subsReview.monthly)} por mês · ${money(subsReview.yearly)} por ano. Para não pagar a próxima, cancele até a data indicada.`}>
        {subsReview.lines.length ? (
          <ul className="divide-y divide-border">
            {subsReview.lines.map((sItem) => {
              const rid = `cancelar:${sItem.id}`, marked = hasReminder(rid);
              return (
                <li key={sItem.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm" data-testid="closing-subscription">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{sItem.name}</span><span className="text-xs text-muted-foreground">{sItem.recurrence === "anual" ? "anual" : "mensal"} · próxima cobrança {dm(sItem.next)} · {sItem.where}</span></span>
                  <strong className="tabular-nums">{money(sItem.value)}</strong>
                  <span className="flex w-full gap-1.5 sm:w-auto">
                    <Button size="sm" variant={marked ? "default" : "outline"} className="h-8 rounded-full" onClick={() => toggleReminder({ id: rid, date: sItem.cancelBy, text: `Cancelar ${sItem.name} antes da cobrança de ${dm(sItem.next)}`, kind: "assinatura" })}><Bell className="h-3.5 w-3.5" /> {marked ? `Lembrete em ${dm(sItem.cancelBy)}` : `Cancelar até ${dm(sItem.cancelBy)}`}</Button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nenhuma assinatura ativa.</p>}
        {reminders.some((r) => r.kind === "assinatura") ? <p className="mt-3 text-[13px] text-muted-foreground">Cancelando as marcadas você economiza {money(subsReview.lines.filter((x) => hasReminder(`cancelar:${x.id}`)).reduce((s, x) => s + x.yearly, 0))} por ano. O cancelamento é feito no serviço; aqui fica o lembrete.</p> : null}
        <Link to="/assinaturas" className="mt-2 inline-block text-[13px] font-semibold text-primary">Abrir Assinaturas</Link>
      </Section>
    ),
    metas: (
      <Section title="Metas" hint={Object.keys(planned.saving ?? {}).length ? "O que o plano de " + name + " previa guardar em cada meta e o que foi guardado de verdade em Metas." : `Sem plano salvo para ${name}: aparecem os aportes feitos em Metas.`} action={<Link to="/metas" className="text-xs font-medium text-primary">Abrir Metas</Link>}>
        {goalRows.length ? (
          <ul className="flex flex-col gap-3.5">
            {goalRows.map((g) => (
              <li key={g.id} data-testid="closing-goal">
                <div className="flex justify-between gap-3 text-sm"><span className="font-medium">{g.name}</span><span className={cn("tabular-nums", g.diff < 0 ? "text-amber-700 dark:text-amber-400" : "text-income")}>{g.planned ? (g.diff < 0 ? `faltou ${money(-g.diff)}` : g.diff > 0 ? `${money(g.diff)} a mais` : "como planejado") : `guardou ${money(g.saved)}`}</span></div>
                {g.planned ? <BulletBar className="mt-1.5" value={Math.max(0, g.saved)} limit={g.planned} format={money} /> : null}
                <p className="mt-1 text-xs text-muted-foreground">{g.planned ? `Planejado ${money(g.planned)} · guardado ${money(g.saved)} · ` : ""}na meta: {money(g.total)} de {money(g.target)}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nenhum aporte planejado ou feito em {name}.</p>}
      </Section>
    ),
    divergiu: (
      <div className="flex flex-col gap-4">
        <Section title="Passaram do limite">
          {div.over.length ? div.over.map((o) => (
            <div key={o.category_id} className="mb-3 last:mb-0">
              <div className="flex justify-between text-sm"><strong>{o.name}</strong><span className="tabular-nums text-expense">{money(o.spent)} de {money(o.limit)} · +{money(o.over)}</span></div>
              <ul className="mt-1 text-[13px] text-muted-foreground">{o.top.map((t) => <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, o.top)} className="flex w-full justify-between gap-2 py-0.5 text-left hover:text-foreground"><span className="truncate">{t.name} · {dm(t.date)}</span><span className="tabular-nums">{money(t.value)}</span></button></li>)}</ul>
            </div>
          )) : <p className="text-sm text-income">Todas as categorias ficaram dentro do limite.</p>}
        </Section>
        <Section title="Contas que subiram">
          {div.priceUps.length ? <ul className="divide-y divide-border text-sm">{div.priceUps.map((l) => <li key={l.tx.id} className="flex justify-between gap-3 py-2"><span>{l.tx.name}<span className="block text-xs text-muted-foreground">{money(l.previous ?? 0)} → {money(l.value)}</span></span><strong className="tabular-nums text-expense">+{money(l.delta ?? 0)}</strong></li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhuma conta fixa veio mais cara que no mês anterior.</p>}
        </Section>
        <Section title="Pode estar repetido">
          {div.dups.length ? <ul className="divide-y divide-border text-sm">{div.dups.map((d) => <li key={`${d.a.id}-${d.b.id}`} className="flex items-center justify-between gap-3 py-2"><span>{d.a.name}<span className="block text-xs text-muted-foreground">{money(d.a.value)} em {dm(d.a.date)} e {dm(d.b.date)}</span></span><Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => dialogs.openTransactionDetail(d.b, [d.a, d.b])}>Conferir</Button></li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhum lançamento repetido encontrado.</p>}
        </Section>
        <Section title="Fora do previsto" hint="Os maiores gastos que não eram contas fixas nem parcelas.">
          {c.unplanned.length ? <ul className="divide-y divide-border text-[13px]">{c.unplanned.slice(0, 6).map((t) => <li key={t.id}><button type="button" onClick={() => dialogs.openTransactionDetail(t, c.unplanned)} className="flex w-full justify-between gap-3 py-2 text-left"><span className="min-w-0"><span className="block truncate font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{dm(t.date)} · {t.category_name ?? "Sem categoria"}</span></span><span className="font-medium tabular-nums">{money(t.value)}</span></button></li>)}</ul> : <p className="text-sm text-muted-foreground">Nada fora do previsto.</p>}
        </Section>
      </div>
    ),
    analise: (
      <div className="flex flex-col gap-4">
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5" data-testid="closing-fiint">
          <p className="flex items-center gap-2 font-heading text-[15px] font-semibold"><Sparkles className="h-4 w-4 text-primary" /> FIINT sobre {name}</p>
          <p className="mt-2 text-[13px] leading-relaxed">Você fechou {name} com <strong>{c.result >= 0 ? `${money(c.result)} de sobra` : `${money(-c.result)} a menos`}</strong>. {c.categories.filter((x) => x.over > 0).length ? `${c.categories.filter((x) => x.over > 0).map((x) => x.name).join(", ")} passou do limite.` : "Todas as categorias ficaram dentro do limite."} {bills.open.length + incomes.open.length ? `${bills.open.length + incomes.open.length} previstos não aconteceram.` : "Todo o previsto aconteceu."}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{c.insights.map((i) => <Button key={i.id} size="sm" variant={q === i.id ? "default" : "outline"} className="rounded-full" onClick={() => setQ(q === i.id ? null : i.id)}>{i.question}</Button>)}</div>
          {q ? (() => { const i = c.insights.find((x) => x.id === q)!; return <div className="mt-3 rounded-xl bg-card p-3 text-[13px]"><p>{i.answer}</p>{i.items.length ? <ul className="mt-2 divide-y divide-border">{i.items.map((t) => <li key={t.id} className="flex justify-between py-1.5"><span>{t.name}<span className="ml-2 text-xs text-muted-foreground">{dm(t.date)}</span></span><span className="tabular-nums">{money(t.value)}</span></li>)}</ul> : null}</div>; })() : null}
        </section>
        <div className={cn("grid gap-4", desktop ? "grid-cols-2" : "grid-cols-1")} data-testid="closing-analyses">
          {ANALYSES.map((id) => <CatalogInsight key={id} id={id} size="M" month={month} to={detailPath(id, { month })} className="min-h-[170px]" />)}
        </div>
        <p className="text-xs text-muted-foreground">As mesmas análises da Análise, lidas para {name}. Toque numa para ver tudo dela; lá dá para trocar o mês.</p>
        <button type="button" onClick={() => setDetails((d) => !d)} aria-expanded={details} className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3.5 text-left">
          <span><span className="block text-sm font-semibold">Saldo, para onde foi e gasto por dia</span><span className="text-xs text-muted-foreground">Os gráficos do mês</span></span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", details && "rotate-180")} />
        </button>
        {details ? (
          <div className={cn("grid gap-4", desktop ? "grid-cols-2" : "grid-cols-1")}>
            <Section title="Saldo ao longo do mês">
              {view.projection.filter((p) => p.kind === "real").length >= 2 ? <ProjectionLine width={desktop ? 520 : 320} height={desktop ? 140 : 110} area points={view.projection.filter((p) => p.kind === "real").map((p) => ({ value: p.value, kind: "real" as const, label: dm(p.date) }))} format={money} /> : <p className="text-sm text-muted-foreground">Sem saldo diário neste mês.</p>}
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-muted-foreground"><span>Começou<strong className="block font-heading text-base text-foreground tabular-nums">{money(c.opening)}</strong></span><ArrowRight className="h-4 w-4" /><span className="text-right">Terminou<strong className="block font-heading text-base text-foreground tabular-nums">{money(c.closing)}</strong></span></div>
            </Section>
            <Section title="Para onde foi o dinheiro">
              {view.slices.length ? <div className="flex flex-wrap items-center gap-4"><Donut slices={view.slices} size={136} selectedId={slice} onSelect={setSlice} centerLabel="no mês" format={(x) => money(Math.round(x)).replace(/,00$/, "")} /><ul className="min-w-[150px] flex-1 text-[13px]">{view.slices.map((s) => <li key={s.id} className="flex items-center gap-2 px-1.5 py-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} /><span className="flex-1 truncate">{s.name}</span><span className="tabular-nums">{money(s.value)}</span></li>)}</ul></div> : <p className="text-sm text-muted-foreground">Nenhum gasto.</p>}
            </Section>
            <Section title={`Gasto por dia em ${name}`} className={desktop ? "col-span-2" : ""}><Heatmap month={month} values={view.heat} today={today} format={money} /></Section>
          </div>
        ) : null}
      </div>
    ),
    fechar: (
      <div className="flex flex-col gap-4">
        <Section title={`Para onde vai a sobra de ${money(sobra)}`}>
          {sobra <= 0 ? <p className="text-[13px] text-muted-foreground">{name} fechou sem sobra. Nada para distribuir.</p> : (
            <>
              <p className="-mt-1 text-[13px] text-muted-foreground">Escolha uma ou mais metas ou outra conta. O que não for distribuído fica em {mainAccount?.name ?? "na conta principal"}.</p>
              <ul className="mt-3 divide-y divide-border">
                {alloc.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><strong className="block truncate">{a.name}</strong><span className="text-xs text-muted-foreground">{a.kind === "meta" ? "Meta · o aporte é registrado em Metas" : "Conta · vira uma transferência no Fluxo"}</span></span>
                    <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => stepAlloc(a.id, -50)} aria-label={`Menos para ${a.name}`}>−</Button>
                    <strong className="w-24 text-center tabular-nums">{money(a.value)}</strong>
                    <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => stepAlloc(a.id, 50)} aria-label={`Mais para ${a.name}`}>+</Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setAlloc((cur) => cur.filter((x) => x.id !== a.id))} aria-label={`Tirar ${a.name}`}>×</Button>
                  </li>
                ))}
                <li className="flex items-center justify-between py-2.5 text-sm"><span><strong className="block">{mainAccount?.name ?? "Conta principal"}</strong><span className="text-xs text-muted-foreground">Fica onde está</span></span><strong className="tabular-nums">{money(rest)}</strong></li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {goals.map((g) => <Button key={g.id} size="sm" variant="outline" className="rounded-full text-primary" onClick={() => addAlloc({ id: `meta:${g.id}`, kind: "meta", name: g.name })}>+ {g.name}</Button>)}
                {accounts.filter((a) => a.active && a.type !== "beneficio" && a.id !== mainAccount?.id).map((a) => <Button key={a.id} size="sm" variant="outline" className="rounded-full" onClick={() => addAlloc({ id: `conta:${a.id}`, kind: "conta", name: a.name })}>→ {a.name}</Button>)}
              </div>
            </>
          )}
          <label className="mt-4 grid gap-1.5 text-[13px] font-semibold">Observação do mês <span className="font-normal text-muted-foreground">(opcional, fica no histórico)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="Ex.: o aniversário da Ana pesou em Restaurantes." className="rounded-xl border border-input bg-background px-3 py-2 text-sm font-normal" data-testid="closing-note" />
          </label>
        </Section>
        <Section title={`Resumo do fechamento de ${name}`}>
          <ul className="space-y-1.5 text-[13px]" data-testid="closing-summary">
            <li>· {c.result >= 0 ? `Sobrou ${money(c.result)}` : `Faltou ${money(-c.result)}`} (entrou {money(c.earned)}, saiu {money(c.spent)})</li>
            <li>· Contas: {bills.paid.length} pagas{bills.open.length ? `, ${bills.open.length} sem pagamento` : ""} · Recebimentos: {incomes.paid.length} recebidos{incomes.open.length ? `, ${incomes.open.length} não caíram` : ""}</li>
            {inst.lines.length ? <li>· Parcelas: faltam {money(inst.future)} até {monthLabel(inst.lastEnd).toLowerCase()}</li> : null}
            {alloc.filter((a) => a.value > 0).map((a) => <li key={a.id}>· {money(a.value)} para {a.kind === "meta" ? `a meta ${a.name}` : a.name}</li>)}
            {reminders.length ? <li>· {reminders.length} {reminders.length === 1 ? "lembrete" : "lembretes"} para {nextName}</li> : null}
            {note.trim() ? <li>· Observação: “{note.trim()}”</li> : null}
          </ul>
          {(Object.keys(pendingOf) as StepId[]).some((id) => pendingOf[id]) ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="closing-pending">
              <p className="font-semibold">Ficou em aberto</p>
              <ul className="mt-1 space-y-1">{(Object.keys(pendingOf) as StepId[]).filter((id) => pendingOf[id]).map((id) => <li key={id} className="flex items-center justify-between gap-2"><span>{LABEL[id]}: {pendingOf[id]} {pendingOf[id] === 1 ? "item" : "itens"}</span><button type="button" onClick={() => go(id)} className="shrink-0 font-semibold underline">Ver</button></li>)}</ul>
              <p className="mt-1.5 text-xs">O que ficar aberto continua no Fluxo.</p>
            </div>
          ) : <p className="mt-3 text-[13px] font-medium text-income">Tudo conferido. Pode fechar.</p>}
        </Section>
      </div>
    ),
  };

  const done = record ? (
    <Panel title={`${monthLabel(month)} fechado`} testId="closing-done">
      <p className="text-[13px] text-muted-foreground">Fechado em {dm(record.closed_at.slice(0, 10))}. O retrato do mês fica guardado na sua conta e aparece em todos os aparelhos.</p>
      {record.allocation.length ? (
        <ul className="mt-3 divide-y divide-border">
          {record.allocation.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span><strong>{a.name}</strong><span className="ml-2 tabular-nums">{money(a.value)}</span></span>
              {a.kind === "meta" ? <Link to="/metas" className="text-xs font-semibold text-primary">Confirmar em Metas</Link>
                : <Button size="sm" variant="outline" className="rounded-full" onClick={() => mainAccount && dialogs.openTransaction({ type: "transferencia", prefill: { type: "transferencia", account_id: mainAccount.id, to_account_id: a.id.slice(6), value: a.value, name: `Sobra de ${name}` } })}>Fazer a transferência</Button>}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/orcamento/novo?mes=${next}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="closing-new-period">Começar {nextName} <ArrowRight className="h-4 w-4" /></Link>
        <Link to={`/orcamento/conta?mes=${month}`} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold">Ver o mês completo</Link>
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> PDF</Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={share}><Share2 className="h-3.5 w-3.5" /> Enviar resumo</Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={() => closings.reopen.mutate(month)}>Reabrir</Button>
      </div>
    </Panel>
  ) : null;

  const kpis: [string, string, string?][] = [["Entrou", `+ ${money(c.earned)}`, "text-income"], ["Saiu", `− ${money(c.spent)}`], [c.result >= 0 ? "Sobrou" : "Faltou", money(Math.abs(c.result)), c.result >= 0 ? "text-primary" : "text-expense"], [`Dia a dia · de ${money(c.dailyPlanned)}`, money(c.dailySpent), c.dailySpent > c.dailyPlanned ? "text-expense" : undefined]];
  const order: StepId[] = ["contas", "recebimentos", "cartoes", "assinaturas", "metas", "divergiu"];
  const sections = (
    <div className={cn("grid items-start gap-4", desktop ? "grid-cols-2" : "grid-cols-1")}>
      {order.map((id) => <div key={id} id={`fechar-${id}`} className={cn("scroll-mt-4", (id === "contas" || id === "divergiu") && desktop && "col-span-2")}>{parts[id]}</div>)}
      <div id="fechar-analise" className={cn("scroll-mt-4", desktop && "col-span-2")}>
        <h2 className="mb-3 font-heading text-lg font-semibold">Análise de {name}</h2>
        {parts.analise}
      </div>
    </div>
  );
  const closeButton = record ? null : (
    <button type="button" disabled={notOver} onClick={() => setSheet(true)} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-bold text-primary-foreground shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50" data-testid="closing-open-sheet">
      <Lock className="h-5 w-5" /> {notOver ? "O mês ainda não terminou" : `Fechar ${name}`}
    </button>
  );
  const sheetEl = (
    <Sheet open={sheet} onOpenChange={setSheet}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 overflow-y-auto p-0", desktop ? "w-full sm:max-w-lg" : "max-h-[92svh] rounded-t-3xl")} data-testid="closing-sheet">
        <SheetHeader className="px-5 pb-2 pt-5"><SheetTitle className="font-heading text-xl">Fechar {name}</SheetTitle><SheetDescription>O destino da sobra, uma observação e o resumo do mês.</SheetDescription></SheetHeader>
        <div className="flex flex-col gap-4 px-5 pb-4">{parts.fechar}</div>
        <div className="sticky bottom-0 border-t border-border bg-popover px-5 py-4">
          <Button className="h-14 w-full rounded-full text-base font-bold" onClick={close} disabled={closings.close.isPending} data-testid="closing-confirm">{closings.close.isPending ? "Fechando…" : `Fechar ${name}`}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
  const successEl = success ? (
    <BudgetSuccess title={`${monthLabel(month).split(" ")[0]} fechado`} amountLabel={c.result >= 0 ? "Sobrou no mês" : "Faltou no mês"} amount={money(Math.abs(c.result))}
      chips={[`Entrou ${money(c.earned)}`, `Saiu ${money(c.spent)}`, ...alloc.filter((a) => a.value > 0).map((a) => `${a.name} ${money(a.value)}`), ...(reminders.length ? [`${reminders.length} lembretes`] : [])]}
      action="Ir para o Orçamento" onDone={() => navigate(`/orcamento?mes=${next}`)} />
  ) : null;

  if (desktop) return (
    <DeskPage testId="budget-closing">
      <DeskHeader title={`Fechar ${name}`} subtitle="Passar o mês a limpo" month={month} setMonth={setMonth} />
      <section className="grid grid-cols-4 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card">{kpis.map(([l, v, cl]) => <div key={l} className="px-5 py-4"><p className="truncate text-xs text-muted-foreground">{l}</p><p className={cn("mt-1 font-heading text-lg font-semibold tabular-nums", cl)}>{v}</p></div>)}</section>
      {done}
      {sections}
      {closeButton ? <div className="mx-auto w-full max-w-md">{closeButton}</div> : null}
      {sheetEl}{successEl}
    </DeskPage>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 pb-6 animate-fade-up" data-testid="budget-closing">
      <BudgetHeader title={`Fechar ${name}`} subtitle="Passar o mês a limpo" month={month} setMonth={setMonth} />
      <section className={cn(card, "grid grid-cols-2 gap-3")}>{kpis.map(([l, v, cl]) => <div key={l}><p className="truncate text-xs text-muted-foreground">{l}</p><p className={cn("font-heading text-base font-bold tabular-nums", cl)}>{v}</p></div>)}</section>
      {done}
      {sections}
      {closeButton}
      {sheetEl}{successEl}
    </div>
  );
}

