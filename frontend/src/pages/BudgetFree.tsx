/**
 * Orçamento · tela 8 (Conta do mês). Uma tela só, que muda com o mês:
 * - mês aberto: a conta do livre para gastar, passo a passo e com a origem de cada valor (Carteira, Fluxo, cartões,
 *   plano do mês, colchão), o livre seguro e o projetado, e o que fica fora;
 * - mês fechado ou que já passou: como o mês fechou nas contas, as análises e o histórico completo daquele mês.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { monthLabel } from "@/lib/format";
import type { MonthView, PlanItem } from "@/lib/budget/monthView";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, dm, h2, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { DeskHeader, DeskPage, Panel, useIsDesktop } from "@/components/budget/desktop/kit";
import { MonthStory } from "@/components/budget/MonthStory";
import { useBudgetClosings } from "@/components/budget/usePlans";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = { id: string; sign: "" | "−" | "+" | "="; label: string; note: string; value: number; kind: "base" | "out" | "total" | "prev" | "proj"; items: { k: string; src: string; v: number }[] };
const SRC: Record<PlanItem["source"], string> = { fluxo: "Fluxo", assinatura: "Assinaturas", cartao: "Carteira · cartão" };

function stepsOf(v: MonthView): Step[] {
  const open = v.items.filter((i) => i.state !== "realizado");
  const bills = open.filter((i) => i.type === "despesa" && i.source !== "cartao");
  const cards = open.filter((i) => i.source === "cartao");
  const incomes = open.filter((i) => i.type === "receita");
  const end = `${v.daysInMonth}/${v.month.slice(5)}`;
  const steps: Step[] = [
    { id: "saldo", sign: "", label: "Saldo nas contas hoje", note: `${v.balances.length} ${v.balances.length === 1 ? "conta" : "contas"}, na Carteira`, value: v.inAccounts, kind: "base", items: v.balances.map((b) => ({ k: b.name, src: "Carteira", v: b.balance })) },
    { id: "contas", sign: "−", label: `Contas a pagar até ${end}`, note: `${bills.length} em aberto${bills.some((b) => b.date < v.today) ? `, ${bills.filter((b) => b.date < v.today).length} vencida(s)` : ""}`, value: bills.reduce((s, i) => s + i.value, 0), kind: "out", items: bills.map((i) => ({ k: `${i.name} · ${i.date < v.today ? "venceu" : "vence"} em ${dm(i.date)}`, src: `${SRC[i.source]} · ${i.state}`, v: i.value })) },
  ];
  if (cards.length) steps.push({ id: "fatura", sign: "−", label: cards.length === 1 ? cards[0].name : "Faturas dos cartões", note: cards.map((c) => `vence em ${dm(c.date)}`).join(" · "), value: cards.reduce((s, i) => s + i.value, 0), kind: "out", items: cards.map((i) => ({ k: i.name, src: "Carteira · compras, parcelas e assinaturas no cartão", v: i.value })) });
  if (v.goalsReserve > 0) steps.push({ id: "metas", sign: "−", label: "Guardar nas metas", note: `Plano de ${monthLabel(v.month).split(" ")[0].toLowerCase()}`, value: v.goalsReserve, kind: "out", items: [{ k: "Aportes planejados do mês", src: "Plano do mês · confirmados em Metas", v: v.goalsReserve }] });
  if (v.cushion > 0) steps.push({ id: "colchao", sign: "−", label: "Colchão na conta", note: "Fica sempre na conta, não é meta", value: v.cushion, kind: "out", items: [{ k: "Definido em Configurar", src: "Orçamento", v: v.cushion }] });
  steps.push({ id: "livre", sign: "=", label: "Livre seguro", note: v.perDay > 0 ? `≈ ${Math.round(v.perDay)} por dia até ${end}` : "O que falta pagar passa do que está nas contas", value: v.free, kind: "total", items: [] });
  if (incomes.length) {
    steps.push({ id: "prev", sign: "+", label: incomes.length === 1 ? `${incomes[0].name} previsto` : "Recebimentos previstos", note: incomes.map((i) => `cai em ${dm(i.date)}`).join(" · ") + " · ainda não entrou", value: v.toReceive, kind: "prev", items: incomes.map((i) => ({ k: i.name, src: `Fluxo · ${i.state}`, v: i.value })) });
    steps.push({ id: "proj", sign: "=", label: "Livre projetado", note: "Se tudo o que está previsto cair", value: v.projectedFree, kind: "proj", items: [] });
  }
  return steps;
}

export default function BudgetFree() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const { view } = useMonthData(month);
  const [open, setOpen] = useState<string | null>("contas");
  const closings = useBudgetClosings();
  const TITLE = "Conta do mês";
  const sub = `${monthLabel(month)}${view?.when === "current" ? ` · hoje, ${dm(view.today)}` : ""}`;

  if (!view) {
    const l = <FinnosPageLoading title="Fazendo a conta" description="Juntando saldos, contas e previstos." />;
    return desktop ? <DeskPage testId="budget-free-page"><DeskHeader title={TITLE} month={month} setMonth={setMonth} />{l}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={TITLE} subtitle={sub} month={month} setMonth={setMonth} />{l}</div>;
  }
  const steps = view.when === "past" ? [] : stepsOf(view);

  const pair = (
    <div className={cn("grid gap-3", desktop ? "grid-cols-1" : "grid-cols-1 min-[420px]:grid-cols-2")}>
      <div className="rounded-2xl border-2 border-income bg-card p-4" data-testid="free-safe"><p className="text-xs font-semibold text-muted-foreground">Livre seguro</p><p className={cn("mt-1 font-heading text-2xl font-bold tabular-nums", view.free < 0 ? "text-expense" : "text-income")}>{money(view.free)}</p><p className="mt-1 text-xs text-muted-foreground">só com o que já está na conta</p></div>
      <div className="rounded-2xl border-2 border-dashed border-border bg-card p-4" data-testid="free-projected"><p className="text-xs font-semibold text-muted-foreground">Livre projetado</p><p className="mt-1 font-heading text-2xl font-bold tabular-nums text-muted-foreground">{money(view.projectedFree)}</p><p className="mt-1 text-xs text-muted-foreground">{view.toReceive > 0 ? `se ${money(view.toReceive)} previstos caírem` : "nada previsto para entrar"}</p></div>
    </div>
  );
  const why = <p className="text-[13px] leading-relaxed text-muted-foreground">O número grande do Orçamento é sempre o seguro: dinheiro previsto só conta quando cair. Saldos vêm da Carteira; contas e receitas, do Fluxo; faturas, dos cartões.</p>;

  const list = (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="free-steps">
      {steps.map((s) => {
        const isOpen = open === s.id && s.items.length > 0;
        return (
          <li key={s.id} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={isOpen} disabled={!s.items.length}
              className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left", s.kind === "total" && "bg-income/10", s.kind === "proj" && "bg-muted/60")}>
              <span className={cn("w-6 shrink-0 text-center font-heading text-base font-bold", s.kind === "out" ? "text-expense" : s.kind === "prev" ? "text-income" : "")}>{s.sign}</span>
              <span className="min-w-0 flex-1"><strong className="block text-sm">{s.label}</strong><span className="text-xs text-muted-foreground">{s.note}</span></span>
              <strong className={cn("whitespace-nowrap tabular-nums", s.kind === "total" ? (s.value < 0 ? "text-expense" : "text-income") : s.kind === "prev" || s.kind === "proj" ? "text-muted-foreground" : "")}>{money(s.value)}</strong>
              {s.items.length ? <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} /> : <span className="w-4" />}
            </button>
            {isOpen ? (
              <ul className="pb-2 pl-[52px] pr-4 text-[13px]">
                {s.items.map((i, n) => <li key={n} className="flex justify-between gap-3 border-t border-border py-1.5"><span className="min-w-0"><span className="block truncate">{i.k}</span><span className="text-[11px] text-muted-foreground">{i.src}</span></span><span className="tabular-nums">{money(i.v)}</span></li>)}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  const outside = (
    <div className="flex flex-col gap-3">
      <ul className="overflow-hidden rounded-2xl border border-border bg-card text-[13px]">
        {view.outside.map((o) => <li key={o.id} className="flex justify-between gap-3 border-b border-border px-4 py-3"><span><strong className="block text-sm">{o.name}</strong><span className="text-muted-foreground">{o.kind === "beneficio" ? "Carteira · vale, só nas compras que ele aceita" : "Limite do banco, não é dinheiro seu"}</span></span><strong className={cn("whitespace-nowrap tabular-nums", o.kind === "cheque" && "text-muted-foreground")}>{money(o.value)}</strong></li>)}
        <li className="px-4 py-3 text-muted-foreground"><strong className="block text-sm text-foreground">Transferências entre suas contas</strong>Mandar de uma conta sua para outra não é gasto: o saldo total continua o mesmo e o livre não muda.</li>
      </ul>
      {view.categories.some((c) => c.benefit > 0) ? <p className="text-xs leading-relaxed text-muted-foreground">Os vales pagaram {view.categories.filter((c) => c.benefit > 0).map((c) => `${money(c.benefit)} de ${c.name}`).join(" e ")} neste mês: saíram deles, não da conta. Contam no limite da categoria.</p> : null}
      <section className="rounded-2xl bg-primary/5 p-4 text-[13px] leading-relaxed"><strong className="mb-1 block text-sm">Sem contar duas vezes</strong>Compras no cartão e assinaturas no cartão entram uma vez só, pela fatura. Parcelas futuras aparecem na fatura do mês em que caem. Gastos do dia a dia já pagos saíram do saldo da conta.</section>
    </div>
  );
  const actions = (
    <div className={cn("flex gap-2", desktop ? "flex-wrap" : "flex-col")}>
      <Link to={`/orcamento?mes=${month}`} className={cn(buttonVariants({ size: desktop ? "default" : "lg" }), "rounded-full")}>Ver contas e transações do mês</Link>
      <Link to="/orcamento/configuracoes" className={cn(buttonVariants({ variant: "outline", size: desktop ? "default" : "lg" }), "rounded-full")}>Mudar o colchão na conta</Link>
    </div>
  );

  // A month that ended (or was closed) tells how it went instead of a livre that no longer exists.
  if (view.when === "past" || closings.closingOf(month)) {
    const closed = !!closings.closingOf(month);
    const sub2 = `${monthLabel(month)} · ${closed ? "fechado" : "ainda não fechado"}`;
    const note = !closed ? <p className="text-[13px] text-muted-foreground">Este mês já terminou. <Link to={`/orcamento/fechar?mes=${month}`} className="font-semibold text-primary">Fechar {monthLabel(month).split(" ")[0].toLowerCase()}</Link> para guardar o retrato do mês.</p> : null;
    return desktop ? (
      <DeskPage testId="budget-free-page"><DeskHeader title={TITLE} month={month} setMonth={setMonth} />{note}<Panel title={sub2}><MonthStory key={month} month={month} money={money} desktop hideOpenNote /></Panel></DeskPage>
    ) : (
      <div className="mx-auto w-full max-w-[1240px] space-y-4" data-testid="budget-free-page"><BudgetHeader title={TITLE} subtitle={sub2} month={month} setMonth={setMonth} />{note}<section className={card}><MonthStory key={month} month={month} money={money} desktop={false} hideOpenNote /></section></div>
    );
  }

  if (desktop) return (
    <DeskPage testId="budget-free-page">
      <DeskHeader title={TITLE} month={month} setMonth={setMonth} />
      <div className="grid grid-cols-12 items-start gap-5">
        <div className="col-span-4 flex flex-col gap-4">{pair}{why}{actions}</div>
        <Panel title="Como o livre é calculado" className="col-span-8" testId="free-steps-panel">{list}</Panel>
        <Panel title="Fora da conta do livre" className="col-span-12">{outside}</Panel>
      </div>
    </DeskPage>
  );
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 animate-fade-up" data-testid="budget-free-page">
      <BudgetHeader title={TITLE} subtitle={sub} month={month} setMonth={setMonth} />
      {pair}{why}
      <h2 className={h2}>Como o livre é calculado</h2>{list}
      <h2 className={h2}>Fora da conta do livre</h2>{outside}
      {actions}
    </div>
  );
}
