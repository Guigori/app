/** Orçamento · visão geral no computador. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { monthLabel } from "@/lib/format";
import { dismissMatch } from "@/lib/budget/prefs";
import type { MonthView } from "@/lib/budget/monthView";
import { BulletBar, Gauge, Heatmap, ProjectionLine } from "@/components/charts/FinnosCharts";
import { TransactionList } from "@/components/transactions/TransactionList";
import { dm, useBudgetMonth, useMoney, useMonthData, useOnline } from "@/components/budget/shared";
import { BudgetFailed, BudgetLoading, NoBudgetCard, OfflineNote } from "@/components/budget/States";
import { HomeInsights, Shortcuts } from "@/components/budget/HomeParts";
import { NextStepCard } from "@/components/budget/NextStep";
import { BillsCard, DistributionCard } from "@/components/budget/HomeCharts";
import { MonthAnalyses } from "@/components/budget/MonthAnalyses";
import { DeskHeader, DeskPage, KpiStrip, Panel, Segmented, td, th } from "@/components/budget/desktop/kit";
import { cn } from "@/lib/utils";
import type { Account, Transaction } from "@/types/finnos";

export default function HomeDesktop() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const { view, today, transactions, accounts, refreshDismissed, hasBudget, failed, retry } = useMonthData(month);
  const online = useOnline();
  return (
    <DeskPage testId="budget-home">
      <DeskHeader title="Orçamento" month={month} setMonth={setMonth} />
      {!online && view ? <OfflineNote /> : null}
      {view && !hasBudget ? <NoBudgetCard /> : view ? <NextStepCard /> : null}
      {!view ? (failed ? <BudgetFailed onRetry={retry} /> : <BudgetLoading desktop />) : <Body v={view} money={money} today={today} transactions={transactions} accounts={accounts} onDismiss={(k) => { dismissMatch(k); refreshDismissed(); }} />}
    </DeskPage>
  );
}

function Body({ v, money, today, transactions, accounts, onDismiss }: { v: MonthView; money: (n: number) => string; today: string; transactions: Transaction[]; accounts: Account[]; onDismiss: (k: string) => void }) {
  const [allCats, setAllCats] = useState(false);
  const navigate = useNavigate();
  const past = v.when === "past";
  // The wide screen has room for every category with a limit; "só as usadas" hides the empty ones.
  const cats = allCats ? v.categories.filter((c) => c.spent > 0) : v.categories;
  return (
    <>
      <KpiStrip items={past ? [
        { label: `Resultado de ${monthLabel(v.month)}`, value: money(v.earned - v.spent), tone: v.earned - v.spent < 0 ? "expense" : undefined },
        { label: "Ganhei", value: `+ ${money(v.earned)}`, tone: "income" },
        { label: "Gastei", value: `− ${money(v.spent)}` },
        { label: "Dia a dia", value: `${money(v.daily.spent)}`, hint: `de ${money(v.daily.limit)} nos limites` },
      ] : [
        { label: v.when === "future" ? "Livre estimado" : `Livre para gastar até ${v.daysInMonth}/${v.month.slice(5)}`, value: money(v.free), tone: v.free < 0 ? "expense" : undefined, hint: <><Link to={`/orcamento/conta?mes=${v.month}`} className="font-medium text-primary" data-testid="budget-free-how">Ver a conta</Link>{v.free > 0 ? ` · ≈ ${money(v.perDay)}/dia` : ""}</>, testId: "budget-free-value" },
        { label: "Nas contas hoje", value: money(v.inAccounts), hint: "Sem VR/VA e cheque especial" },
        { label: "Falta pagar", value: `− ${money(v.toPay)}`, tone: "expense", hint: <Link to={`/orcamento/compromissos?mes=${v.month}`} className="font-medium text-primary" data-testid="budget-to-pay-link">Ver compromissos</Link> },
        { label: "A receber", value: `+ ${money(v.toReceive)}`, tone: "income", hint: "Só entra quando cair" },
        { label: "Já saiu da conta", value: `− ${money(v.leftAccounts)}`, hint: `Ganhei ${money(v.earned)}` },
      ]} />

      <div className="grid grid-cols-12 items-start gap-5">
        <div className="col-span-8 flex min-w-0 flex-col gap-5">
          <Panel title="Saldo até o fim do mês" action={<span className="text-xs text-muted-foreground">Real até hoje · estimativa tracejada</span>}>
            {v.projection.length >= 2 ? <ProjectionLine points={v.projection.map((p) => ({ value: p.value, kind: p.kind, label: dm(p.date) }))} width={760} height={170} format={money} ariaLabel={`Saldo termina perto de ${money(v.endBalance)}`} /> : <p className="py-10 text-center text-sm text-muted-foreground">Ainda não há saldo para desenhar neste mês.</p>}
            {v.lowest && !past ? <div className="mt-3 flex gap-6 border-t border-border pt-3 text-xs text-muted-foreground"><span>Menor ponto previsto <strong className="ml-1 text-sm text-foreground tabular-nums">{money(v.lowest.value)}</strong> em {dm(v.lowest.date)}</span><span>Fim do mês <strong className="ml-1 text-sm text-foreground tabular-nums">{money(v.endBalance)}</strong></span></div> : null}
          </Panel>
          <div className={cn("grid gap-5", v.goals.length ? "grid-cols-2" : "grid-cols-1")}>
            <Panel title="Dia a dia">
              {v.daily.limit > 0 ? (
                <div className="flex items-center gap-5">
                  <Gauge size={150} percent={v.daily.percent} detail={<>{money(v.daily.spent)} de {money(v.daily.limit)}</>}><span className="font-heading text-xl font-semibold tabular-nums">{Math.round(v.daily.percent * 100)}%</span></Gauge>
                  <table className="w-full text-left text-[13px]"><tbody className="divide-y divide-border">
                    <tr><td className="py-1.5 text-muted-foreground">Gasto</td><td className="py-1.5 text-right font-medium tabular-nums">{money(v.daily.spent)}</td></tr>
                    <tr><td className="py-1.5 text-muted-foreground">Limites</td><td className="py-1.5 text-right tabular-nums">{money(v.daily.limit)}</td></tr>
                    <tr><td className="py-1.5 text-muted-foreground">Mês que passou</td><td className="py-1.5 text-right tabular-nums">{Math.round(v.daily.elapsed * 100)}%</td></tr>
                    {v.when === "current" ? <tr><td className="py-1.5 text-muted-foreground">Livre por dia</td><td className={cn("py-1.5 text-right font-medium tabular-nums", v.daily.spent > v.daily.limit && "text-expense")}>{v.daily.spent > v.daily.limit ? "esgotado" : money(v.daily.allowance)}</td></tr> : null}
                  </tbody></table>
                </div>
              ) : <p className="text-sm text-muted-foreground">Sem limites. <Link to="/orcamento/configuracoes" className="font-medium text-primary">Definir</Link></p>}
            </Panel>
            {v.goals.length ? (
              <Panel title="Metas" action={<Link to="/metas" className="text-xs font-medium text-primary">Abrir Metas</Link>}>
                <ul className="flex flex-col gap-3">{v.goals.slice(0, 4).map((g) => (
                  <li key={g.id}><Link to={`/metas?meta=${g.id}`} className="block"><div className="flex justify-between gap-2 text-[13px]"><span className="truncate font-medium">{g.name}</span><span className="tabular-nums text-muted-foreground">{money(g.saved)} / {money(g.target)}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(g.percent * 100)}%` }} /></div></Link></li>
                ))}</ul>
              </Panel>
            ) : null}
          </div>
          <Panel flush title="Limites por categoria" action={<Link to={`/orcamento/gastos?mes=${v.month}`} className="pr-5 text-xs font-medium text-primary">Gastos do mês</Link>}>
            <table className="w-full">
              <thead className="border-y border-border bg-muted/40"><tr><th className={cn(th, "pl-5")}>Categoria</th><th className={cn(th, "w-[38%]")}>Uso do limite</th><th className={cn(th, "text-right")}>Gasto</th><th className={cn(th, "text-right")}>Limite</th><th className={cn(th, "pr-5 text-right")}>Resta</th></tr></thead>
              <tbody className="divide-y divide-border">
                {cats.map((c) => (
                  <tr key={c.category_id} data-testid="budget-category" className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/orcamento/gastos?mes=${v.month}&categoria=${c.category_id}`)}>
                    <td className={cn(td, "whitespace-nowrap pl-5")}><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: c.color }} />{c.name}{c.benefit > 0 ? <span title={`${money(c.benefit)} pagos com VR/VA`} className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">VR/VA</span> : null}</td>
                    <td className={td}><BulletBar value={c.spent} limit={c.limit} striped={c.benefit} stripedLabel="com VR/VA" format={money} /></td>
                    <td className={cn(td, "whitespace-nowrap text-right tabular-nums", c.over > 0 && "font-semibold text-expense")}>{money(c.spent)}</td>
                    <td className={cn(td, "whitespace-nowrap text-right tabular-nums text-muted-foreground")}>{money(c.limit)}</td>
                    <td className={cn(td, "whitespace-nowrap pr-5 text-right tabular-nums", c.over > 0 && "text-expense")}>{c.over > 0 ? `− ${money(c.over)}` : money(c.limit - c.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
              <span>Listrado = pago com VR/VA (conta no limite).</span>
              {v.categories.some((c) => c.spent === 0) ? <button type="button" onClick={() => setAllCats((a) => !a)} className="font-medium text-primary">{allCats ? `Ver todas (${v.categories.length})` : "Só as usadas"}</button> : null}
            </div>
          </Panel>
          <div className="grid grid-cols-2 items-start gap-5">
            <BillsCard v={v} money={money} kind="despesa" />
            <BillsCard v={v} money={money} kind="receita" />
          </div>
        </div>
        <div className="col-span-4 flex min-w-0 flex-col gap-5">
          <Panel title="O que importa agora">
            <HomeInsights v={v} money={money} onDismiss={onDismiss} transactions={transactions} accounts={accounts} max={5} />
            {past ? <p className="text-sm text-muted-foreground">Mês encerrado. <Link to={`/orcamento/conta?mes=${v.month}`} className="font-medium text-primary">Ver como fechou</Link></p> : null}
          </Panel>
          <DistributionCard v={v} money={money} />
          <Panel title="Atalhos"><Shortcuts month={v.month} columns={2} /></Panel>
          <Panel title="Gasto por dia"><Heatmap month={v.month} values={v.heat} today={today} format={money} /></Panel>
        </div>
      </div>

      <MonthAnalyses v={v} columns={3} />
      <Transactions v={v} money={money} transactions={transactions} />
    </>
  );
}


function Transactions({ v, money, transactions }: { v: MonthView; money: (n: number) => string; transactions: Transaction[] }) {
  const [tab, setTab] = useState<"todas" | "pagar" | "receber">("todas");
  const list = transactions.filter((t) => tab === "todas" || (tab === "pagar" ? t.type === "despesa" && t.status !== "pago" : t.type === "receita" && t.status !== "pago")).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const invoices = v.items.filter((i) => i.source === "cartao" && tab !== "receber");
  return (
    <section aria-label="Transações do mês" data-testid="budget-transactions">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-semibold">Transações de {monthLabel(v.month).split(" ")[0].toLowerCase()}</h2>
        <div className="flex items-center gap-3"><Segmented label="Filtrar" value={tab} onChange={setTab} options={[["todas", "Todas"], ["pagar", "A pagar"], ["receber", "A receber"]] as const} /><Link to={`/transacoes?month=${v.month}`} className="text-xs font-medium text-primary">Ver todas no Fluxo</Link></div>
      </div>
      {invoices.length ? (
        <div className="mb-3 flex flex-wrap gap-3">
          {invoices.map((i) => <Link key={i.key} to={`/cartoes/${i.card_id}`} className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] hover:bg-muted/40"><span><span className="block font-medium">{i.name}</span><span className="text-xs text-muted-foreground">Vence {dm(i.date)} · Carteira</span></span><strong className="tabular-nums text-expense">−{money(i.value)}</strong></Link>)}
        </div>
      ) : null}
      {list.length ? <TransactionList transactions={list} /> : <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Nenhuma transação aqui neste mês.</p>}
    </section>
  );
}
