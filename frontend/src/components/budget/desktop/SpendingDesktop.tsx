/** Orçamento · gastos do mês no computador: tabela de categorias com o ritmo e os lançamentos abrindo na própria linha. */
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { monthLabel } from "@/lib/format";
import type { MonthView } from "@/lib/budget/monthView";
import type { Pace, SpendingView } from "@/lib/budget/spending";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { Bars, BulletBar, Donut } from "@/components/charts/FinnosCharts";
import { CategoryHistory } from "@/components/budget/CategoryHistory";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { TransactionList } from "@/components/transactions/TransactionList";
import { dm } from "@/components/budget/shared";
import { DeskHeader, DeskPage, KpiStrip, Panel, Segmented, td, th } from "@/components/budget/desktop/kit";
import { cn } from "@/lib/utils";

const PACE: Record<Pace, [string, string]> = {
  dentro: ["No ritmo", "bg-income/10 text-income"],
  acelerado: ["Um pouco acelerado", "bg-amber-500/15 text-amber-800 dark:text-amber-200"],
  acima: ["Acima do plano", "bg-expense/10 text-expense"],
};

export function SpendingDesktop({ month, setMonth, money, view, s }: { month: string; setMonth: (m: string) => void; money: (n: number) => string; view: MonthView | null; s: SpendingView | null }) {
  const { openTransactionDetail } = useDialogs();
  const [count, setCount] = useState<"compra" | "caixa">("compra");
  const [tab, setTab] = useState<"categorias" | "ultimos">("categorias");
  const [open, setOpen] = useState<string | null>(null);
  const [slice, setSlice] = useState<string | null>(null);
  const name = monthLabel(month).split(" ")[0].toLowerCase();
  return (
    <DeskPage testId="budget-spending">
      <DeskHeader title="Gastos do mês" month={month} setMonth={setMonth} />
      {!s || !view ? <FinnosPageLoading title="Carregando gastos" description="Juntando os lançamentos do mês." /> : (
        <>
          <KpiStrip
            items={[
              { label: "Gasto no dia a dia", value: money(s.spent), hint: `${s.planned ? Math.round((s.spent / s.planned) * 100) : 0}% do plano · ${Math.round(s.elapsed * 100)}% do mês`, testId: "spending-pace" },
              { label: "Plano do mês", value: money(s.planned), hint: `${s.categories.length} categorias com limite` },
              { label: view.when === "past" ? "Fechou com" : "Nesse ritmo fecha com", value: money(view.when === "past" ? s.spent : s.projected), tone: s.projected > s.planned ? "expense" : undefined, hint: s.driver ? `${s.driver.name} puxa a diferença` : "Contas fixas não entram no ritmo" },
              { label: view.when === "current" ? "Livre por dia" : "Categorias acima", value: view.when === "current" ? money(view.daily.allowance) : String(s.categories.filter((c) => c.over > 0).length), hint: view.when === "current" ? `nos ${s.days - s.day} dias que faltam` : undefined },
            ]}
            aside={<span className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold", PACE[s.pace][1])}>{PACE[s.pace][0]}</span>}
          />

          <div className="grid grid-cols-12 gap-5">
            <Panel title="Contar gastos" className="col-span-4" testId="spending-count">
              <div className="-mt-1 mb-3"><Segmented label="Contar por" value={count} onChange={setCount} options={[["compra", "Quando comprou"], ["caixa", "Quando sai da conta"]] as const} /></div>
              <p className="font-heading text-2xl font-semibold tabular-nums">{money(count === "compra" ? s.byPurchase : s.leftAccounts)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{count === "compra" ? `Compras feitas em ${name}, inclusive no cartão. Vale para os limites.` : `Saiu da conta em ${name}: débito, Pix, vales e faturas pagas. Vale para o livre.`}</p>
              <table className="mt-3 w-full text-[13px]"><tbody className="divide-y divide-border">
                {s.origins.map((o) => <tr key={o.id}><td className="py-2 text-muted-foreground">{o.label}</td><td className="py-2 text-right font-medium tabular-nums">{money(o.value)}</td></tr>)}
              </tbody></table>
            </Panel>
            <Panel title="Para onde foi" className="col-span-4">
              {view.slices.length ? (
                <div className="flex items-center gap-4">
                  <Donut slices={view.slices} size={128} selectedId={slice} onSelect={setSlice} centerLabel="no mês" format={(x) => money(Math.round(x)).replace(/,00$/, "")} />
                  <ul className="min-w-0 flex-1 text-[13px]">{view.slices.map((c) => <li key={c.id}><button type="button" onClick={() => setSlice(slice === c.id ? null : c.id)} className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1", slice === c.id && "bg-muted")}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} /><span className="flex-1 truncate text-left">{c.name}</span><span className="tabular-nums">{money(c.value)}</span></button></li>)}</ul>
                </div>
              ) : <p className="text-sm text-muted-foreground">Nenhum gasto no mês ainda.</p>}
            </Panel>
            <Panel title="Por semana" className="col-span-4">
              <Bars height={150} format={money} data={s.weeks.map((w) => ({ label: w.label, value: w.value, focus: w.current, future: w.future, valueLabel: w.future ? "a vir" : money(w.value) }))} />
            </Panel>
          </div>

          <Panel flush title={tab === "categorias" ? "Categorias" : "Últimos gastos"} action={<span className="pr-5"><Segmented label="Ver" value={tab} onChange={setTab} options={[["categorias", "Por categoria"], ["ultimos", "Últimos gastos"]] as const} /></span>}>
            {tab === "categorias" ? (
              <table className="w-full" data-testid="spending-categories">
                <thead className="border-y border-border bg-muted/40"><tr><th className={cn(th, "w-8 pl-5")} aria-label="Abrir" /><th className={th}>Categoria</th><th className={cn(th, "w-[30%]")}>Uso do limite</th><th className={cn(th, "text-right")}>Gasto</th><th className={cn(th, "text-right")}>Limite</th><th className={th}>Ritmo</th><th className={cn(th, "pr-5 text-right")}>Por dia</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {s.categories.map((c) => {
                    const isOpen = open === c.category_id;
                    const status = c.spent > c.limit ? ["Passou " + money(c.over), "text-expense"] : c.passBy > 0 && view.when === "current" ? ["Passa " + money(c.passBy), "text-amber-700 dark:text-amber-300"] : ["Dentro", "text-income"];
                    return (
                      <Fragment key={c.category_id}>
                        <tr className="cursor-pointer hover:bg-muted/30" onClick={() => setOpen(isOpen ? null : c.category_id)} aria-expanded={isOpen}>
                          <td className={cn(td, "pl-5")}><ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} /></td>
                          <td className={cn(td, "font-medium")}><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: c.color }} />{c.name}</td>
                          <td className={td}><BulletBar value={c.spent} limit={c.limit} striped={c.benefit} stripedLabel="com VR/VA" format={money} /></td>
                          <td className={cn(td, "text-right tabular-nums", c.over > 0 && "font-semibold text-expense")}>{money(c.spent)}</td>
                          <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>{money(c.limit)}</td>
                          <td className={cn(td, "text-xs font-medium", status[1])}>{status[0]}</td>
                          <td className={cn(td, "pr-5 text-right tabular-nums text-muted-foreground")}>{view.when === "current" && c.spent < c.limit ? money(c.perDay) : "—"}</td>
                        </tr>
                        {isOpen ? (
                          <tr className="bg-muted/20"><td colSpan={7} className="px-5 pb-3 pt-1">
                            {c.items.length ? (
                              <table className="w-full text-[13px]"><tbody>
                                {c.items.slice(0, 10).map((t) => <tr key={t.id} onClick={(e) => { e.stopPropagation(); openTransactionDetail(t, c.items); }} className="cursor-pointer hover:bg-muted/50"><td className="w-20 py-1.5 pl-8 text-muted-foreground">{dm(t.date)}</td><td className="py-1.5">{t.name}</td><td className="py-1.5 text-muted-foreground">{t.card_name ?? t.account_name}</td><td className="py-1.5 pr-2 text-right font-medium tabular-nums">{money(t.installment ? t.installment_value ?? t.value : t.value)}</td></tr>)}
                              </tbody></table>
                            ) : <p className="py-1.5 pl-8 text-[13px] text-muted-foreground">Nenhum gasto nesta categoria ainda.</p>}
                            <div className="max-w-xl pl-8"><CategoryHistory categoryId={c.category_id} name={c.name} month={month} money={money} /></div>
                            <div className="mt-1 flex gap-4 pl-8 text-xs">
                              <Link to={`/transacoes?month=${month}&category_id=${c.category_id}`} className="font-medium text-primary">Ver no Fluxo</Link>
                              <Link to="/orcamento/configuracoes" className="font-medium text-primary">Ajustar limite</Link>
                            </div>
                          </td></tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="px-5 pb-5" data-testid="spending-recent">{s.recent.length ? <TransactionList transactions={s.recent} /> : <p className="text-sm text-muted-foreground">Nenhum gasto no mês ainda.</p>}</div>}
          </Panel>

          {s.tip ? (
            <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-3 text-[13px]" data-testid="spending-tip">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span><strong>FIINT</strong> · Para {s.tip.category} fechar no limite, dá para gastar até <strong>{money(s.tip.perDay)} por dia</strong> nela até {s.tip.until}.</span>
            </div>
          ) : null}
        </>
      )}
    </DeskPage>
  );
}
