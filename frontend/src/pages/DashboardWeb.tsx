import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CreditCard, Plus, Wallet } from "lucide-react";
import { fetchAccounts, fetchCalendar, fetchDashboard, fetchMe, fetchCards, fetchBudget } from "@/lib/data";
import { currentMonth, firstName, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { HomeFinancialChart } from "@/components/dashboard/HomeFinancialChart";
import { ExpensesDonutChart } from "@/components/dashboard/ExpensesDonutChart";
import { RadarSection } from "@/components/dashboard/RadarSection";
import { fetchRadar } from "@/lib/data";
import type { MetricKind } from "@/types/finnos";

const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const changeMonth = (month: string, delta: number) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-10" data-testid="dashboard-web-v2">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Visão financeira</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Olá, {me.data ? firstName(me.data.name) : "bem-vindo"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Seu dinheiro, com clareza.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggle} className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted" aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>{hidden ? "Mostrar valores" : "Ocultar valores"}</button>
          <button type="button" onClick={() => dialogs.openTransaction()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Plus size={17} /> Novo lançamento</button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium"><CalendarDays size={17} className="text-primary" /> {monthLabel(month)}</div>
        <div className="flex items-center gap-2">
          <button aria-label="Mês anterior" onClick={() => { setMonth(changeMonth(month, -1)); }} className="rounded-lg p-2 hover:bg-muted"><ChevronLeft size={18} /></button>
          <button onClick={() => { setMonth(currentMonth()); setSelectedDate(null); }} className="rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted">Hoje</button>
          <button aria-label="Próximo mês" onClick={() => { setMonth(changeMonth(month, 1)); setSelectedDate(null); }} className="rounded-lg p-2 hover:bg-muted"><ChevronRight size={18} /></button>
        </div>
      </div>

      {dashboard.isError && <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm">Não foi possível carregar o resumo financeiro. <button className="ml-2 underline" onClick={() => dashboard.refetch()}>Tentar novamente</button></div>}
      {dashboard.isPending && <div className="h-44 animate-pulse rounded-2xl bg-muted" aria-label="Carregando resumo" />}
      {data && (
        <section className="grid gap-3 md:grid-cols-3" aria-label="Resumo financeiro">
          {[
            { title: "Saldo disponível", amount: data.total_balance, icon: Wallet, kind: "balance" as MetricKind, highlight: true },
            { title: "Despesas do mês", amount: data.expense, icon: ArrowUpRight, kind: "expense" as MetricKind },
            { title: "Resultado do mês", amount: data.month_balance, icon: CreditCard, kind: "balance" as MetricKind },
          ].map(({ title, amount, icon: Icon, kind, highlight }) => (
            <button key={title} onClick={() => go(kind)} className={`group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${highlight ? "border-primary/30 bg-gradient-to-br from-[#070F52] to-[#4B2CFF] text-white" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between gap-3"><span className={`text-sm ${highlight ? "text-white/75" : "text-muted-foreground"}`}>{title}</span><Icon size={18} className={highlight ? "text-white/75" : "text-primary"} /></div>
              <p className="mt-2 font-heading text-2xl font-semibold tracking-tight">{display(amount)}</p>
              <span className={`mt-1 inline-flex items-center gap-1 text-xs ${highlight ? "text-white/75" : "text-muted-foreground"}`}>Ver detalhes <ArrowRight size={12} /></span>
            </button>
          ))}
        </section>
      )}

      {accounts.isSuccess && accounts.data.length === 0 && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div><h2 className="font-semibold">Comece cadastrando uma conta</h2><p className="mt-1 text-sm text-muted-foreground">Depois, registre sua primeira movimentação para acompanhar o saldo.</p></div>
          <Link to="/contas" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Cadastrar conta</Link>
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Minhas contas</h2><Link to="/contas" className="text-xs text-primary">Ver todas</Link></div>
          {accounts.isPending && <p className="text-sm text-muted-foreground">Carregando contas…</p>}
          {accounts.isError && <p className="text-sm text-muted-foreground">Contas indisponíveis.</p>}
          {accounts.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>}
          <div className="space-y-1">{accounts.data?.slice(0,3).map(a=><Link key={a.id} to="/contas" className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"><div className="min-w-0"><p className="truncate text-sm font-medium">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.institution}</p></div><strong className="shrink-0 text-sm">{display(a.balance)}</strong></Link>)}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Cartões de crédito</h2><Link to="/cartoes" className="text-xs text-primary">Ver cartões</Link></div>
          {cards.isPending && <p className="text-sm text-muted-foreground">Carregando cartões…</p>}
          {cards.isError && <p className="text-sm text-muted-foreground">Cartões indisponíveis.</p>}
          {cards.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cartão cadastrado.</p>}
          <div className="space-y-1">{cards.data?.filter(c=>c.active).slice(0,3).map(c=><Link key={c.id} to="/cartoes" className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"><div className="min-w-0"><p className="truncate text-sm font-medium">{c.name}</p><p className="truncate text-xs text-muted-foreground">Vencimento: {c.next_due}</p></div><div className="text-right"><strong className="block text-sm">{display(c.current_invoice)}</strong><span className="text-xs text-muted-foreground">Disponível: {display(c.available)}</span></div></Link>)}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Ritmo do mês</h2><Link to="/orcamento" className="text-xs text-primary">Orçamento</Link></div>
          {budget.isPending && <p className="text-sm text-muted-foreground">Carregando orçamento…</p>}
          {budget.isError && <p className="text-sm text-muted-foreground">Orçamento indisponível.</p>}
          {budget.data && <><p className="text-xs text-muted-foreground">Ainda disponível no orçamento</p><p className="mt-1 font-heading text-2xl font-semibold">{display(budget.data.remaining)}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.max(0,Math.min(100,budget.data.percent))}%`}} /></div><p className="mt-2 text-xs text-muted-foreground">{display(budget.data.spent)} utilizados de {display(budget.data.planned)} planejados</p></>}
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Próximos dias</h2><Link to="/fluxo" className="text-xs text-primary">Fluxo completo</Link></div>
          {calendar.isPending && <p className="text-sm text-muted-foreground">Carregando previsões…</p>}
          {calendar.isError && <p className="text-sm text-muted-foreground">Previsões indisponíveis.</p>}
          <div className="space-y-2">{days.filter(d=>d.date>=today&&(d.projected_income>0||d.projected_expense>0)).slice(0,4).map(d=><div key={d.date} className="flex items-center justify-between text-sm"><span>{d.date.split("-").reverse().join("/")}</span><span className="font-medium">{display(d.projected_income-d.projected_expense)}</span></div>)}</div>
          {calendar.isSuccess && !days.some(d=>d.date>=today&&(d.projected_income>0||d.projected_expense>0)) && <p className="text-sm text-muted-foreground">Sem movimentações previstas para o restante do mês.</p>}
          <Link to="/fluxo" className="mt-4 inline-flex items-center gap-1 text-xs text-primary"><CalendarDays size={14}/> Abrir calendário financeiro</Link>
        </section>
      </div>
      {data && <section className="space-y-5">
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-heading text-lg font-semibold">Evolução financeira</h2><p className="text-xs text-muted-foreground">Explore seus gráficos sem sair do painel</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Tipo de gráfico" value={chartView} onChange={(e) => setChartView(e.target.value as typeof chartView)} className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <option value="Projeção">Projeção</option><option value="Linhas">Linhas</option><option value="Barras">Barras</option><option value="Pizza">Pizza</option>
              </select>
              <select aria-label="Período do gráfico" value={chartPeriod} onChange={(e) => setChartPeriod(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <option>7 dias</option><option>1 mês</option><option>3 meses</option><option>6 meses</option><option>1 ano</option>
              </select>
              <Link to="/fluxo" className="text-xs font-medium text-primary">Análise completa</Link>
            </div>
          </div>
          <HomeFinancialChart month={data.month} total={data.total_balance} income={data.income} expense={data.expense} result={data.month_balance} onOpenMetric={go} menuView={chartView} menuInterval={chartPeriod} menuSeries={["Receitas", "Despesas", "Resultado"]} />
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <ExpensesDonutChart month={data.month} slices={data.categories} total={data.expense} onOpenDetails={() => go("expense")} onOpenCategory={(slice) => navigate(`/fluxo?month=${month}&metric=despesas&category_id=${encodeURIComponent(slice.category_id ?? "")}`)} />
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-lg font-semibold">Resumo do período</h2>
            <p className="mt-1 text-xs text-muted-foreground">Distribuição de receitas e despesas</p>
            <div className="mt-6 space-y-5">
              {([{label:"Receitas", value:data.income, kind:"income"}, {label:"Despesas", value:data.expense, kind:"expense"}, {label:"Resultado", value:data.month_balance, kind:"balance"}] as const).map((item) => (
                <button key={item.label} onClick={() => go(item.kind)} className="flex w-full items-center justify-between border-b border-border/60 pb-4 text-left text-sm hover:text-primary">
                  <span>{item.label}</span><strong className="font-heading">{display(item.value)}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-heading text-base font-semibold">Atividade recente</h2><Link to="/transacoes" className="text-xs text-primary">Ver todas</Link></div>
          {data?.recent.length ? data.recent.slice(0,4).map(tx=><div key={tx.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{tx.name}</p><p className="text-xs text-muted-foreground">{tx.date} · {tx.category_name??tx.type}</p></div><span className="shrink-0 text-sm font-semibold">{tx.type==="despesa"?"−":"+"}{display(Math.abs(tx.value))}</span></div>):<p className="text-sm text-muted-foreground">Nenhuma movimentação recente.</p>}
        </section>
        <RadarSection signals={radar.data?.items ?? []} totalCount={radar.data?.count ?? 0} />
      </div>
    </div>
  );
}
