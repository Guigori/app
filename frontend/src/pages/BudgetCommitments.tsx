/**
 * Orçamento · tela 9 (Compromissos). O que já está assumido no mês: contas, faturas, assinaturas, receitas e aportes
 * do plano, cada um com o estado (Realizado, Agendado, Estimativa) e a origem. Só mostra: tocar abre o registro no
 * módulo de origem. Embaixo, o que já está agendado para os próximos meses.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink } from "lucide-react";
import { fetchFlow, fetchInvoice } from "@/lib/data";
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

function hintOf(c: Commitment): string {
  if (c.done) return `${c.kind === "receber" ? "Recebido" : "Pago"} em ${dm(c.date)}.`;
  if (c.kind === "meta") return "O aporte é feito em Metas, quando você guardar o dinheiro.";
  if (c.kind === "cartao") return "Compras, parcelas e assinaturas no cartão entram uma vez só, pela fatura.";
  if (c.kind === "assinatura") return "Cobrada pela assinatura. Se for no cartão, entra pela fatura.";
  if (c.kind === "receber") return c.state === "estimativa" ? "Previsto. Só entra no livre quando cair." : "Agendado. Só entra no livre quando cair.";
  if (c.late) return "Já venceu. Registre o pagamento no Fluxo quando pagar.";
  return c.state === "estimativa" ? "Estimativa: pode ou não acontecer. Confirme no Fluxo quando pagar." : "Tem data marcada no Fluxo.";
}

function openLink(c: Commitment, month: string): { to: string; label: string } | null {
  if (c.transaction_id) return { to: `/transacoes?month=${c.date.slice(0, 7) || month}&highlight=${c.transaction_id}`, label: "Abrir no Fluxo" };
  if (c.card_id) return { to: `/cartoes/${c.card_id}`, label: "Abrir a fatura" };
  if (c.subscription_id) return { to: "/assinaturas", label: "Abrir em Assinaturas" };
  if (c.goal_id) return { to: "/metas", label: "Abrir em Metas" };
  return { to: `/transacoes?month=${month}`, label: "Ver no Fluxo" };
}

/** The invoice lines (installments, subscriptions, previous balance), read from Cartões when the row opens. */
function InvoiceParts({ c, money }: { c: Commitment; money: (v: number) => string }) {
  const cycle = c.key.split(":")[2] || undefined;
  const q = useQuery({ queryKey: ["invoice", c.card_id, cycle], queryFn: () => fetchInvoice(c.card_id!, cycle), enabled: Boolean(c.card_id) });
  if (q.isPending) return <p className="py-1.5 text-xs text-muted-foreground">Lendo a fatura…</p>;
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const top = [...items].sort((a, b) => b.value - a.value);
  const shown = top.slice(0, 5), rest = top.slice(5).reduce((s, i) => s + i.value, 0);
  return (
    <>
      {shown.map((i) => <div key={i.id} className="flex justify-between gap-3 border-t border-border/60 py-1.5"><span className="truncate">{i.name}{i.installment_label ? ` · ${i.installment_label}` : ""}</span><span className="tabular-nums">{money(i.value)}</span></div>)}
      {rest > 0 ? <div className="flex justify-between gap-3 border-t border-border/60 py-1.5 text-muted-foreground"><span>Outras {top.length - 5} compras</span><span className="tabular-nums">{money(rest)}</span></div> : null}
    </>
  );
}

function Row({ c, open, onToggle, money, month }: { c: Commitment; open: boolean; onToggle: () => void; money: (v: number) => string; month: string }) {
  const link = openLink(c, month);
  const soon = !c.done && !c.late && c.days >= 0 && c.days <= 3 && c.kind !== "receber" && c.kind !== "meta";
  return (
    <li className="border-b border-border/60 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
        <span className={cn("grid h-12 w-11 shrink-0 place-content-center rounded-xl text-center", c.late ? "bg-expense/10 text-expense" : "bg-primary/[0.07]", c.done && "text-muted-foreground")}>
          <strong className="font-heading text-base leading-none">{c.date.slice(8)}</strong>
          <span className="mt-1 text-[10px] font-bold tracking-wide">{MON[Number(c.date.slice(5, 7)) - 1]}</span>
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{c.name}</strong>
          <span className={cn("text-xs", c.late ? "text-expense" : soon ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{c.status}</span>
        </span>
        <strong className={cn("text-sm tabular-nums", c.kind === "receber" && "text-income", c.done && c.kind !== "receber" && "text-muted-foreground")}>{c.kind === "receber" ? "+ " : ""}{money(c.value)}</strong>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="px-4 pb-4 pl-[4.5rem] text-[13px]">
          <div className="flex justify-between gap-3 py-1.5 text-muted-foreground"><span>Origem</span><strong className="text-foreground">{c.origin}</strong></div>
          {c.kind === "cartao" ? <InvoiceParts c={c} money={money} /> : null}
          <p className="mt-2 rounded-xl bg-primary/[0.06] px-3 py-2 text-xs">{hintOf(c)}</p>
          {link ? <Link to={link.to} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">{link.label} <ExternalLink className="h-3.5 w-3.5" /></Link> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function BudgetCommitments() {
  const [month, setMonth] = useBudgetMonth();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const { view, goals } = useMonthData(month);
  const plans = useBudgetPlans();
  const plan = plans.planOf(month);
  const [filter, setFilter] = useState<CommitmentFilter>("todos");
  const [open, setOpen] = useState<string | null>(null);

  const ahead = [1, 2, 3, 4, 5, 6].map((n) => addMonth(month, n));
  const flows = useQueries({ queries: ahead.map((m) => ({ queryKey: ["flow", "orcamento", m], queryFn: () => fetchFlow({ month: m, months: 1 }) })) });
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
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));
  const list = shown.length ? (
    <ul>{shown.map((c) => <Row key={c.key} c={c} open={open === c.key} onToggle={() => toggle(c.key)} money={money} month={month} />)}</ul>
  ) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada {filter === "receber" ? "a receber" : filter === "cartao" ? "no cartão" : "a pagar"} neste mês.</p>;
  const legend = <p className="text-xs leading-relaxed text-muted-foreground">Realizado: o dinheiro já entrou ou saiu da conta. Agendado: tem data marcada. Estimativa: pode ou não acontecer.{data.pendingSuggestions ? <> {data.pendingSuggestions} {data.pendingSuggestions === 1 ? "sugestão espera" : "sugestões esperam"} revisão em <Link to={`/orcamento/proximo?mes=${month}`} className="font-semibold text-primary">Planejar</Link>: só entram se você aprovar.</> : null}</p>;

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
