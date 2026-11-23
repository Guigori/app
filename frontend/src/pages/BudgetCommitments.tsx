/**
 * Orçamento · tela 9 (Compromissos). O que já está assumido no mês: contas, faturas, assinaturas, receitas e aportes
 * do plano, cada um com o estado (Realizado, Agendado, Estimativa) e a origem. Só mostra: tocar abre o registro no
 * módulo de origem. Embaixo, o que já está agendado para os próximos meses.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellRing, ChevronRight } from "lucide-react";
import { fetchFlow, transactionInput, updateTransaction } from "@/lib/data";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import type { Transaction } from "@/types/finnos";
import { addMonth, monthLabel } from "@/lib/format";
import { buildCommitments, buildFuture, passes, type Commitment, type CommitmentFilter } from "@/lib/budget/commitments";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, dm, h2, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { DeskHeader, DeskPage, KpiStrip, Panel, Segmented, useIsDesktop } from "@/components/budget/desktop/kit";
import { useBudgetPlans } from "@/components/budget/usePlans";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TITLE = "Compromissos";
const FILTERS = [["todos", "Todos"], ["pagar", "A pagar"], ["receber", "A receber"], ["cartao", "Cartão"]] as const;
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MON = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** Where a commitment that is not a Fluxo record opens: the invoice, the subscription or the goal. */
function linkOf(c: Commitment, month: string): string {
  if (c.card_id) { const cycle = c.key.split(":")[2]; return `/cartoes/${c.card_id}${/^\d{4}-\d{2}-\d{2}$/.test(cycle ?? "") ? `?cycle=${cycle}` : ""}`; }
  if (c.subscription_id) return `/assinaturas?assinatura=${c.subscription_id}`;
  if (c.goal_id) return `/metas?meta=${c.goal_id}`;
  return `/transacoes?month=${month}`;
}

/** One commitment: tapping opens it where it lives (a Fluxo record opens in the register); the bell turns its
 * reminder on or off in the Fluxo record itself. */
function Row({ c, tx, siblings, money, month }: { c: Commitment; tx: Transaction | undefined; siblings: Transaction[]; money: (v: number) => string; month: string }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const soon = !c.done && !c.late && c.days >= 0 && c.days <= 3 && c.kind !== "receber" && c.kind !== "meta";
  const open = () => (tx ? dialogs.openTransactionDetail(tx, siblings) : navigate(linkOf(c, month)));
  const notify = tx?.notify_enabled ?? false;
  const toggleBell = async () => {
    if (!tx || busy) return;
    setBusy(true);
    try {
      await updateTransaction(tx.id, transactionInput(tx, { notify_enabled: !notify }), "manual", tx.version);
      await qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(!notify ? `Você vai ser avisado de ${tx.name}.` : `Aviso de ${tx.name} desligado.`);
    } catch { toast.error("Não deu para mudar o aviso agora."); } finally { setBusy(false); }
  };
  return (
    <li className="flex items-center gap-1 border-b border-border/60 pr-2 last:border-0" data-testid="commitment-row">
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
        <span className={cn("grid h-12 w-11 shrink-0 place-content-center rounded-xl text-center", c.late ? "bg-expense/10 text-expense" : "bg-primary/[0.07]", c.done && "text-muted-foreground")}>
          <strong className="font-heading text-base leading-none">{c.date.slice(8)}</strong>
          <span className="mt-1 text-[10px] font-bold tracking-wide">{MON[Number(c.date.slice(5, 7)) - 1]}</span>
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{c.name}</strong>
          <span className={cn("block truncate text-xs", c.late ? "text-expense" : soon ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{c.status}</span>
        </span>
        <strong className={cn("shrink-0 text-sm tabular-nums", c.kind === "receber" && "text-income", c.done && c.kind !== "receber" && "text-muted-foreground")}>{c.kind === "receber" ? "+ " : ""}{money(c.value)}</strong>
      </button>
      {tx && !c.done ? (
        <button type="button" onClick={toggleBell} disabled={busy} aria-pressed={notify} aria-label={notify ? `Desligar aviso de ${c.name}` : `Avisar de ${c.name}`}
          className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", notify ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")} data-testid="commitment-bell">
          {notify ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </button>
      ) : <ChevronRight className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />}
    </li>
  );
}

export default function BudgetCommitments() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const { view, goals, transactions } = useMonthData(month);
  const plans = useBudgetPlans();
  const plan = plans.planOf(month);
  const [filter, setFilter] = useState<CommitmentFilter>("todos");

  const ahead = [1, 2, 3, 4, 5, 6].map((n) => addMonth(month, n));
  const flows = useQueries({ queries: ahead.map((m) => ({ queryKey: ["flow", "orcamento", m], queryFn: () => fetchFlow({ month: m, months: 2 }) })) });
  const future = useMemo(() => buildFuture(flows.flatMap((q, i) => (q.data ? [{ month: ahead[i], flow: q.data }] : []))), [flows.map((q) => q.dataUpdatedAt).join(), month]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!view) return null;
    const saving = Object.entries(plan.saving ?? {}).map(([id, value]) => ({ id, name: goals.find((g) => g.id === id)?.name ?? "do plano", value }));
    return buildCommitments(view, view.when === "past" ? [] : saving);
  }, [view, plan.saving, goals]);

  const sub = `${monthLabel(month)} · o que já está assumido`;
  if (!view || !data) {
    const l = <FinnosPageLoading title="Juntando compromissos" description="Contas do Fluxo, faturas dos cartões, assinaturas e metas." />;
    return desktop ? <DeskPage testId="budget-commitments-page"><DeskHeader title={TITLE} month={month} setMonth={setMonth} />{l}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={TITLE} subtitle={sub} month={month} setMonth={setMonth} />{l}</div>;
  }

  const shown = data.items.filter((c) => passes(c, filter));
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const siblings = shown.map((c) => (c.transaction_id ? txById.get(c.transaction_id) : undefined)).filter((t): t is Transaction => Boolean(t));
  const list = shown.length ? (
    <ul>{shown.map((c) => <Row key={c.key} c={c} tx={c.transaction_id ? txById.get(c.transaction_id) : undefined} siblings={siblings} money={money} month={month} />)}</ul>
  ) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada {filter === "receber" ? "a receber" : filter === "cartao" ? "no cartão" : "a pagar"} neste mês.</p>;
  const legend = <p className="text-xs leading-relaxed text-muted-foreground">Toque para abrir no registro. O sino liga o aviso do lançamento no Fluxo. Realizado: o dinheiro já entrou ou saiu. Agendado: tem data marcada. Estimativa: pode ou não acontecer.{data.pendingSuggestions ? <> {data.pendingSuggestions} {data.pendingSuggestions === 1 ? "sugestão espera" : "sugestões esperam"} revisão em <Link to={`/orcamento/proximo?mes=${month}`} className="font-semibold text-primary">Planejar</Link>: só entram se você aprovar.</> : null}</p>;

  const firstWeek = data.week.find((d) => d.items.length);
  const weekNote = firstWeek ? `${WD[new Date(`${firstWeek.date}T12:00:00`).getDay()]}, ${firstWeek.date.slice(8)}: ${firstWeek.items.slice(0, 2).map((x) => `${x.name} ${money(x.value)}`).join(", ")}${firstWeek.items.length > 2 ? "…" : ""}` : "Nada vence nos próximos 7 dias.";
  const week = data.week.length ? (
    <>
      <div className="grid grid-cols-7 gap-1 text-center">
        {data.week.map((d, i) => {
          const late = d.items.some((x) => x.late), recv = d.items.some((x) => x.kind === "receber");
          return (
            <span key={d.date} className={cn("block rounded-xl py-1.5", i === 0 && "bg-primary/[0.07]")} title={d.items.map((x) => x.name).join(", ") || undefined}>
              <span className="block text-[10px] text-muted-foreground">{WD[new Date(`${d.date}T12:00:00`).getDay()]}</span>
              <strong className="block font-heading text-[15px]">{Number(d.date.slice(8))}</strong>
              <span aria-hidden="true" className={cn("mx-auto mt-1 block h-2 w-2 rounded-full", !d.items.length && "opacity-0", late ? "bg-expense" : recv && d.items.every((x) => x.kind === "receber") ? "bg-income" : "border-2 border-primary")} />
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{weekNote}</p>
    </>
  ) : null;

  const futureList = future.length ? (
    <ul className="divide-y divide-border/60 text-sm">
      {future.slice(0, 8).map((f) => <li key={f.key} className="flex justify-between gap-3 py-2.5"><span className="min-w-0"><span className="block truncate">{f.name}</span><span className="block text-xs text-muted-foreground">{f.note} · Fluxo</span></span><strong className="shrink-0 tabular-nums">{money(f.value)}{f.monthly ? "/mês" : ""}</strong></li>)}
    </ul>
  ) : <p className="text-sm text-muted-foreground">Nada agendado para os próximos meses.</p>;
  const futureNote = <p className="text-xs text-muted-foreground">Registros com data marcada no Fluxo e parcelas dos cartões. Viram realizados quando o dinheiro sair da conta.</p>;
  const footer = <p className="text-xs leading-relaxed text-muted-foreground">O Orçamento só mostra. Cada compromisso continua no módulo de origem: Fluxo, Cartões, Assinaturas ou Metas.</p>;
  const lateHint = data.late ? `${data.late} ${data.late === 1 ? "vencida" : "vencidas"}` : "nada vencido";
  const recvHint = data.nextReceive ? `${data.nextReceive.name} em ${dm(data.nextReceive.date)}` : "nada previsto";

  if (desktop) return (
    <DeskPage testId="budget-commitments-page">
      <DeskHeader title={TITLE} month={month} setMonth={setMonth} />
      <KpiStrip items={[
        { label: "Falta pagar", value: money(data.toPay), hint: lateHint, tone: data.late ? "expense" : undefined, testId: "commitments-to-pay" },
        { label: "A receber", value: money(data.toReceive), hint: recvHint, tone: "income" },
        { label: "Já pago no mês", value: money(data.paid), hint: "contas, faturas e assinaturas" },
        { label: "Compromissos", value: String(data.items.length), hint: `${data.items.filter((x) => x.done).length} já realizados` },
      ]} />
      <div className="grid grid-cols-12 gap-5">
        <Panel flush className="col-span-8 overflow-hidden" title="Do mês" action={<Segmented label="Filtrar" value={filter} options={FILTERS} onChange={setFilter} />}>
          {list}
          <div className="border-t border-border px-5 py-3">{legend}</div>
        </Panel>
        <div className="col-span-4 space-y-5">
          {week ? <Panel title="Próximos 7 dias">{week}</Panel> : null}
          <Panel title="Agendados nos próximos meses" action={<Link to={`/orcamento/projecao?mes=${addMonth(month, 1)}`} className="text-xs font-semibold text-primary">Ver na projeção</Link>}>
            <div className="space-y-2">{futureNote}{futureList}</div>
          </Panel>
          {footer}
        </div>
      </div>
    </DeskPage>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4" data-testid="budget-commitments-page">
      <BudgetHeader title={TITLE} subtitle={sub} month={month} setMonth={setMonth} />
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">Falta pagar</span><strong className="block font-heading text-[15px] tabular-nums" data-testid="commitments-to-pay">{money(data.toPay)}</strong><span className={cn("block text-[11px]", data.late ? "text-expense" : "text-muted-foreground")}>{lateHint}</span></div>
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">A receber</span><strong className="block font-heading text-[15px] tabular-nums text-income">{money(data.toReceive)}</strong><span className="block truncate text-[11px] text-muted-foreground">{recvHint}</span></div>
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">Já pago</span><strong className="block font-heading text-[15px] tabular-nums">{money(data.paid)}</strong><span className="block text-[11px] text-muted-foreground">no mês</span></div>
      </div>
      {week ? <section className={card}><div className="mb-2 flex items-baseline justify-between"><h2 className={h2}>Próximos dias</h2><span className="text-xs text-muted-foreground">do Calendário</span></div>{week}</section> : null}
      <div role="tablist" aria-label="Filtrar" className="flex gap-1.5 overflow-x-auto">
        {FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("h-9 shrink-0 rounded-full px-3.5 text-[13px] font-bold", filter === k ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{l}</button>)}
      </div>
      <section className="overflow-hidden rounded-[20px] border border-border bg-card">{list}</section>
      {legend}
      <section className={card}>
        <h2 className={h2}>Agendados nos próximos meses</h2>
        <div className="mt-1 space-y-2">{futureNote}{futureList}</div>
      </section>
      <Link to={`/orcamento/projecao?mes=${addMonth(month, 1)}`} className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-full")}>Ver na projeção</Link>
      {footer}
    </div>
  );
}
