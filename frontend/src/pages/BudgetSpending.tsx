/**
 * Orçamento · tela 2 (Gastos do mês). The day-to-day against the limits: the month's pace, counting by purchase or by
 * what left the account, each category with its pace and its lançamentos, and the latest spending in the Fluxo list.
 * Read only: a lançamento opens where it lives (Fluxo), a limit is changed in Configurar.
 */
import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Sparkles } from "lucide-react";
import { monthLabel } from "@/lib/format";
import { buildSpendingView, type Pace } from "@/lib/budget/spending";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { Bars, BulletBar, Donut } from "@/components/charts/FinnosCharts";
import { CategoryHistory } from "@/components/budget/CategoryHistory";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { TransactionList } from "@/components/transactions/TransactionList";
import { BudgetHeader, card, dm, h2, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/components/budget/desktop/kit";
import { SpendingDesktop } from "@/components/budget/desktop/SpendingDesktop";

const PACE: Record<Pace, { label: string; tone: string; dot: string }> = {
  dentro: { label: "No ritmo", tone: "bg-income/10 text-income", dot: "bg-income" },
  acelerado: { label: "Um pouco acelerado", tone: "bg-amber-500/15 text-amber-900 dark:text-amber-200", dot: "bg-amber-500" },
  acima: { label: "Acima do plano", tone: "bg-expense/10 text-expense", dot: "bg-expense" },
};

export default function BudgetSpending() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const { view, today, transactions, accounts } = useMonthData(month);
  const { openTransactionDetail } = useDialogs();
  const [count, setCount] = useState<"compra" | "caixa">("compra");
  const [tab, setTab] = useState<"categorias" | "ultimos">("categorias");
  // ?categoria=<id> (from the Orçamento's start) opens that category and scrolls to it.
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get("categoria"));
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("categoria");
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(`gasto-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 600);
    return () => window.clearTimeout(t);
  }, []);
  const [slice, setSlice] = useState<string | null>(null);

  const s = useMemo(() => (view ? buildSpendingView({ month, today, categories: view.categories, transactions, accounts, monthExpense: view.spent }) : null), [view, month, today, transactions, accounts]);
  const desktop = useIsDesktop();
  if (desktop) return <SpendingDesktop month={month} setMonth={setMonth} money={money} view={view} s={s} />;
  const subtitle = s && view?.when === "current" ? `${monthLabel(month)} · dia ${s.day} de ${s.days}` : monthLabel(month);

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-5 animate-fade-up" data-testid="budget-spending">
      <BudgetHeader title="Gastos do mês" subtitle={subtitle} month={month} setMonth={setMonth} />
      {!s || !view ? <FinnosPageLoading title="Carregando gastos" description="Juntando os lançamentos do mês." /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section aria-label="Ritmo do mês" className={cn("rounded-[24px] p-5 lg:col-span-7", PACE[s.pace].tone)} data-testid="spending-pace">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><span className={cn("h-2 w-2 rounded-full", PACE[s.pace].dot)} />{PACE[s.pace].label}</span>
              <div className="mt-2.5 flex items-baseline justify-between gap-3"><span className="text-[13px] font-semibold">Gasto no dia a dia</span><strong className="font-heading text-3xl tabular-nums">{money(s.spent)}</strong></div>
              <div className="relative mt-3 h-3 rounded-full bg-current/15">
                <span className={cn("absolute inset-y-0 left-0 rounded-full", PACE[s.pace].dot)} style={{ width: `${Math.min(100, s.planned ? (s.spent / s.planned) * 100 : 0)}%` }} />
                <span title="Hoje" className="absolute -bottom-1 -top-1 w-0.5 bg-current" style={{ left: `${s.elapsed * 100}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs"><span>{s.planned ? Math.round((s.spent / s.planned) * 100) : 0}% do plano</span><span>{Math.round(s.elapsed * 100)}% do mês</span></div>
              <p className="mt-3 text-sm leading-relaxed">
                {view.when === "past" ? <>Você fechou {monthLabel(month)} com <strong>{money(s.spent)}</strong> no dia a dia, de um plano de {money(s.planned)}.</>
                  : !s.planned ? <>Sem limites neste mês. <Link to="/orcamento/configuracoes" className="font-semibold underline">Definir limites</Link></>
                  : <>Nesse ritmo você fecha {monthLabel(month).split(" ")[0].toLowerCase()} com <strong>{money(s.projected)}</strong>, {money(Math.abs(s.projected - s.planned))} {s.projected > s.planned ? "acima" : "abaixo"} do plano de {money(s.planned)}.{s.driver ? <> {s.driver.name} puxa a diferença.</> : null}</>}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="min-w-0 rounded-2xl bg-card/60 px-2.5 py-2.5"><dt>Plano</dt><dd className="mt-0.5 truncate font-heading text-[13px] font-bold tabular-nums sm:text-base">{money(s.planned)}</dd></div>
                <div className="min-w-0 rounded-2xl bg-card/60 px-2.5 py-2.5"><dt>{view.when === "past" ? "Gasto" : "Nesse ritmo"}</dt><dd className="mt-0.5 truncate font-heading text-[13px] font-bold tabular-nums sm:text-base">{money(view.when === "past" ? s.spent : s.projected)}</dd></div>
                <div className="min-w-0 rounded-2xl bg-card/60 px-2.5 py-2.5"><dt>{view.when === "current" ? "Livre por dia" : "Categorias acima"}</dt><dd className="mt-0.5 truncate font-heading text-[13px] font-bold tabular-nums sm:text-base">{view.when === "current" ? money(view.daily.allowance) : s.categories.filter((c) => c.over > 0).length}</dd></div>
              </dl>
            </section>
            <section aria-label="Contar por" className={cn(card, "lg:col-span-5")} data-testid="spending-count">
              <div role="radiogroup" aria-label="Contar gastos por" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
                {([["compra", "Quando comprou"], ["caixa", "Quando sai da conta"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={count === k} onClick={() => setCount(k)} className={cn("h-9 rounded-full text-[13px] font-semibold", count === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>{l}</button>)}
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3"><span className="text-[13px] text-muted-foreground">{count === "compra" ? `Compras feitas em ${monthLabel(month).split(" ")[0].toLowerCase()}` : `Dinheiro que saiu da conta em ${monthLabel(month).split(" ")[0].toLowerCase()}`}</span><strong className="font-heading text-xl tabular-nums">{money(count === "compra" ? s.byPurchase : s.leftAccounts)}</strong></div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{count === "compra" ? "Conta cada compra no dia em que foi feita, inclusive no cartão. É o que vale para os limites das categorias." : `Conta o que saiu da conta: débito, Pix, vales e as faturas pagas no mês. As compras no cartão deste mês (${money(s.onCards)}) saem quando a fatura vencer. É o que vale para o livre e a projeção.`}</p>
              <ul className="mt-3 border-t border-border">
                {s.origins.map((o) => <li key={o.id} className="flex justify-between border-b border-border py-2 text-sm last:border-b-0"><span className="text-muted-foreground">{o.label}</span><strong className="tabular-nums">{money(o.value)}</strong></li>)}
              </ul>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section aria-label="Por categoria" className={card}>
              <h2 className={h2}>Para onde foi</h2>
              {view.slices.length ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Donut slices={view.slices} size={132} selectedId={slice} onSelect={setSlice} centerLabel="no mês" format={(x) => money(Math.round(x)).replace(/,00$/, "")} />
                  <div className="flex min-w-[150px] flex-1 flex-col gap-0.5">
                    {view.slices.map((c) => <button key={c.id} type="button" onClick={() => setSlice(slice === c.id ? null : c.id)} aria-pressed={slice === c.id} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]", slice === c.id && "bg-muted")}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} /><span className="flex-1 truncate text-left">{c.name}</span><strong className="tabular-nums">{money(c.value)}</strong></button>)}
                  </div>
                </div>
              ) : <p className="mt-4 text-sm text-muted-foreground">Nenhum gasto no mês ainda.</p>}
            </section>
            <section aria-label="Por semana" className={card}>
              <h2 className={h2}>Por semana</h2>
              <Bars className="mt-4" height={150} format={money} data={s.weeks.map((w) => ({ label: w.label, value: w.value, focus: w.current, future: w.future, valueLabel: w.future ? "a vir" : money(w.value) }))} />
              <p className="mt-2 text-xs text-muted-foreground">A semana de hoje fica em destaque. Toque numa barra para ver o valor.</p>
            </section>
          </div>

          <div role="tablist" aria-label="Ver" className="grid max-w-md grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([["categorias", "Por categoria"], ["ultimos", "Últimos gastos"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-9 rounded-full text-[13px] font-semibold", tab === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>{l}</button>)}
          </div>

          {tab === "categorias" ? (
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2" data-testid="spending-categories">
              {s.categories.length ? s.categories.map((c) => {
                const isOpen = open === c.category_id;
                return (
                  <div key={c.category_id} id={`gasto-${c.category_id}`} className="scroll-mt-4 overflow-hidden rounded-[20px] border border-border bg-card">
                    <button type="button" onClick={() => setOpen(isOpen ? null : c.category_id)} aria-expanded={isOpen} className="block w-full px-4 py-3.5 text-left">
                      <span className="flex justify-between gap-3 text-sm"><strong className="truncate">{c.name}</strong><span className="tabular-nums"><strong>{money(c.spent)}</strong><span className="text-muted-foreground"> de {money(c.limit)}</span></span></span>
                      <span className="relative mt-2.5 block"><BulletBar value={c.spent} limit={c.limit} striped={c.benefit} stripedLabel="com VR/VA" format={money} /><span className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 bg-muted-foreground/60" style={{ left: `${(s.elapsed * c.limit / (Math.max(c.spent, c.limit) * 1.08)) * 100}%` }} aria-hidden="true" /></span>
                      <span className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className={cn("font-semibold", c.spent > c.limit ? "text-expense" : c.passBy > 0 ? "text-amber-700 dark:text-amber-300" : "text-income")}>{c.spent > c.limit ? `Passou ${money(c.over)} do limite` : c.passBy > 0 && view.when === "current" ? `Nesse ritmo passa ${money(c.passBy)}` : "Dentro do limite"}</span>
                        <span className="flex items-center gap-1 text-muted-foreground">{view.when === "current" && c.spent < c.limit ? `até ${money(c.perDay)} por dia` : null}<ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} /></span>
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="px-4 pb-3.5 text-[13px]">
                        {c.items.length ? c.items.slice(0, 8).map((t) => (
                          <button key={t.id} type="button" onClick={() => openTransactionDetail(t, c.items)} className="flex w-full justify-between gap-3 border-t border-border py-2 text-left">
                            <span className="min-w-0"><span className="block truncate font-medium">{t.name}</span><span className="text-[11px] text-muted-foreground">{dm(t.date)} · {t.card_name ?? t.account_name}</span></span><strong className="tabular-nums">{money(t.installment ? t.installment_value ?? t.value : t.value)}</strong>
                          </button>
                        )) : <p className="border-t border-border py-2 text-muted-foreground">Nenhum gasto nesta categoria ainda.</p>}
                        <CategoryHistory categoryId={c.category_id} name={c.name} month={month} money={money} />
                        <div className="mt-2 flex gap-4">
                          {c.items.length > 8 ? <Link to={`/transacoes?month=${month}&category_id=${c.category_id}`} className="font-semibold text-primary">Ver todos no Fluxo</Link> : null}
                          <Link to={`/orcamento/configuracoes?categoria=${c.category_id}`} className="font-semibold text-primary">Ajustar limite</Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }) : <p className={cn(card, "text-sm text-muted-foreground")}>Nenhuma categoria com limite neste mês. <Link to="/orcamento/configuracoes" className="font-semibold text-primary">Definir limites</Link></p>}
            </div>
          ) : (
            <div data-testid="spending-recent">
              {s.recent.length ? <TransactionList transactions={s.recent} /> : <p className={cn(card, "text-sm text-muted-foreground")}>Nenhum gasto no mês ainda.</p>}
            </div>
          )}

          {s.tip ? (
            <section aria-label="Dica" className="flex gap-3 rounded-[20px] bg-primary/10 p-4" data-testid="spending-tip">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
              <p className="text-[13px] leading-relaxed"><strong className="block text-sm">FIINT</strong>Para {s.tip.category} fechar no limite, dá para gastar até <strong>{money(s.tip.perDay)} por dia</strong> nela até {s.tip.until}. Ou ajuste o limite no planejamento do próximo mês.</p>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
