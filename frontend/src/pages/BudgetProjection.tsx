/**
 * Orçamento · tela 4 (Projeção). Os próximos meses com o que você registrou no Fluxo: cada mês fecha com sobra ou falta.
 * Só lê: tocar num registro abre no Fluxo; registrar algo novo abre o formulário do Fluxo.
 */
import { Fragment, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { fetchFlow, fetchTransactions, fetchTrends } from "@/lib/data";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { buildProjection, type ProjectionItem, type ProjectionMonth } from "@/lib/budget/projection";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, h2, useBudgetMonth, useMoney } from "@/components/budget/shared";
import { DeskHeader, DeskPage, KpiStrip, Panel, Segmented, td, th, useIsDesktop } from "@/components/budget/desktop/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mName = (m: string) => NAMES[Number(m.slice(5)) - 1];
const mShort = (m: string) => mName(m).slice(0, 3);

export default function BudgetProjection() {
  const [month, setMonth] = useBudgetMonth(addMonth(currentMonth(), 1));
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const [h, setH] = useState<"3" | "6" | "12">("6");
  const [sel, setSel] = useState<string | null>(null);
  const months = useMemo(() => Array.from({ length: Number(h) }, (_, i) => addMonth(month, i)), [month, h]);
  const flows = useQueries({ queries: months.map((m) => ({ queryKey: ["flow", "orcamento", m], queryFn: () => fetchFlow({ month: m, months: 1 }) })) });
  const last = addMonth(currentMonth(), -1);
  const trends = useQuery({ queryKey: ["trends", 3, last], queryFn: () => fetchTrends(3, last) });
  const ready = flows.every((f) => f.data) && trends.data;
  const view = useMemo(() => (ready ? buildProjection({ months, flows: Object.fromEntries(months.map((m, i) => [m, flows[i].data])), history: trends.data!.months }) : null), [ready, months, flows, trends.data]);

  const open = async (i: ProjectionItem) => {
    if (!i.transaction_id) return;
    const list = await qc.fetchQuery({ queryKey: ["transactions", { month: i.date.slice(0, 7) }], queryFn: () => fetchTransactions({ month: i.date.slice(0, 7) }) });
    const t = list.find((x) => x.id === i.transaction_id);
    if (t) dialogs.openTransactionDetail(t, list);
  };
  const register = (type: "receita" | "despesa") => dialogs.openTransaction({ type, date: `${sel ?? month}-15`, prefill: { status: "pendente" } });
  const shown = view ? (sel ? view.months.filter((m) => m.month === sel) : view.months) : [];
  const max = view ? Math.max(1, ...view.months.map((m) => Math.abs(m.total))) : 1;
  const horizon = <Segmented label="Horizonte" value={h} onChange={(v) => { setH(v); setSel(null); }} options={[["3", "3 meses"], ["6", "6 meses"], ["12", "12 meses"]] as const} />;

  const bars = view ? (
    <div>
      <div className="flex h-44 gap-1.5">
        {view.months.map((m) => (
          <button key={m.month} type="button" onClick={() => setSel(sel === m.month ? null : m.month)} aria-pressed={sel === m.month} aria-label={`${mName(m.month)}: ${m.total >= 0 ? "sobra" : "falta"} ${money(Math.abs(m.total))}`} className={cn("flex flex-1 flex-col rounded-md", sel === m.month && "bg-primary/10")}>
            <span className="flex flex-1 items-end border-b border-muted-foreground/60 px-[12%]"><span className="block w-full rounded-t" style={{ height: m.total > 0 ? `${(m.total / max) * 100}%` : 0, backgroundColor: "var(--finnos-purple)", opacity: sel && sel !== m.month ? 0.35 : 1 }} /></span>
            <span className="flex flex-1 items-start px-[12%]"><span className="block w-full rounded-b bg-expense" style={{ height: m.total < 0 ? `${(-m.total / max) * 100}%` : 0, opacity: sel && sel !== m.month ? 0.35 : 1 }} /></span>
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-center text-[11px] text-muted-foreground">{view.months.map((m) => <span key={m.month} className="flex-1">{mShort(m.month)}</span>)}</div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />sobra</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-expense" />falta</span><span>Toque num mês para ver só ele</span></div>
    </div>
  ) : null;

  const summary = view ? (view.negative.length
    ? { tone: "bg-amber-500/15 text-amber-900 dark:text-amber-100", kicker: "Atenção", title: `${view.negative.length} ${view.negative.length > 1 ? "meses ficam" : "mês fica"} no vermelho`, text: `O pior é ${mName(view.worst!.month)} (${money(view.worst!.total)}).${view.yearly ? ` Guardando ${money(view.yearly.perMonth)} por mês numa meta, as despesas grandes deixam de pesar de uma vez.` : ""}` }
    : { tone: "bg-income/10 text-income", kicker: "Tranquilo", title: "Todos os meses fecham com sobra", text: `No período sobram ${money(view.sum)} no total.` }) : null;
  const meta = view?.yearly ? (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-card/70 p-3 text-[13px] text-foreground">
      <span className="min-w-0 flex-1"><strong className="block">Meta “Despesas do ano”</strong>{money(view.yearly.perMonth)} por mês para {view.yearly.items.map((i) => i.name).join(", ")}.</span>
      <Link to="/metas" className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">Criar em Metas</Link>
    </div>
  ) : null;

  const monthBlock = (m: ProjectionMonth, compact: boolean) => (
    <div key={m.month} className={cn("overflow-hidden rounded-2xl border bg-card", m.total < 0 ? "border-expense/40" : "border-border")}>
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", m.total < 0 && "bg-expense/5")}><strong className="font-heading text-[15px] capitalize">{mName(m.month)}</strong><span className={cn("text-[13px] font-semibold tabular-nums", m.total >= 0 ? "text-income" : "text-expense")}>{m.total >= 0 ? `Sobra ${money(m.total)}` : `Falta ${money(-m.total)}`}</span></div>
      {m.items.map((i) => (
        <button key={i.key} type="button" onClick={() => open(i)} className="flex w-full items-center gap-3 border-t border-border px-4 py-2.5 text-left hover:bg-muted/40">
          <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2", i.state === "agendado" ? "border-primary" : "border-dashed border-muted-foreground")} />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.name}</span>{compact ? null : <span className="text-xs text-muted-foreground">{i.date.slice(8)}/{i.date.slice(5, 7)} · {i.state === "agendado" ? "agendado" : "estimativa"}</span>}</span>
          <span className={cn("text-sm font-semibold tabular-nums", i.type === "receita" ? "text-income" : "text-expense")}>{i.type === "receita" ? "+ " : "− "}{money(i.value)}</span>
        </button>
      ))}
      {!m.items.length ? <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Só o de sempre: renda, contas fixas e dia a dia.</p> : null}
    </div>
  );

  if (desktop) return (
    <DeskPage testId="budget-projection">
      <DeskHeader title="Projeção" month={month} setMonth={setMonth} actions={<span className="mr-2">{horizon}</span>} />
      {!view || !summary ? <FinnosPageLoading title="Calculando a projeção" description="Juntando o que você registrou no Fluxo." /> : (
        <>
          <KpiStrip items={[
            { label: `Resultado em ${view.months.length} meses`, value: money(view.sum), tone: view.sum < 0 ? "expense" : undefined, hint: `de ${mName(view.months[0].month)} a ${mName(view.months.at(-1)!.month)}` },
            { label: "Mês de sempre", value: money(view.base), hint: view.monthsObserved ? `média dos últimos ${view.monthsObserved} meses` : "ainda sem histórico" },
            { label: "Meses no vermelho", value: String(view.negative.length), tone: view.negative.length ? "expense" : "income", hint: view.worst ? `pior: ${mName(view.worst.month)}` : "nenhum" },
            { label: "Registros no período", value: String(view.months.reduce((s, m) => s + m.items.length, 0)), hint: "agendados e estimativas do Fluxo" },
          ]} aside={<span className={cn("rounded-full px-3 py-1 text-xs font-semibold", summary.tone)}>{summary.kicker}</span>} />
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-5 flex flex-col gap-5">
              <Panel title="Sobra de cada mês">{bars}</Panel>
              <section className={cn("rounded-2xl p-5", summary.tone)}><p className="font-heading text-lg font-semibold">{summary.title}</p><p className="mt-1 text-[13px] text-foreground/80">{summary.text}</p>{meta}</section>
              <p className="px-1 text-xs text-muted-foreground">Cada mês = o resultado de sempre ({money(view.base)}) + o que está registrado no Fluxo naquele mês. Contas que só se repetem e assinaturas já estão na média.</p>
            </div>
            <Panel flush className="col-span-7" title={sel ? `Só ${mName(sel)}` : "O que pesa no caminho"} action={<span className="flex gap-1.5 pr-5"><Button size="sm" variant="outline" className="rounded-full" onClick={() => register("despesa")}><Plus className="h-3.5 w-3.5" /> Conta futura</Button><Button size="sm" variant="outline" className="rounded-full" onClick={() => register("receita")}><Plus className="h-3.5 w-3.5" /> A receber</Button></span>}>
              <table className="w-full">
                <thead className="border-y border-border bg-muted/40"><tr><th className={cn(th, "pl-5")}>Mês</th><th className={th}>Registro</th><th className={th}>Situação</th><th className={cn(th, "pr-5 text-right")}>Valor</th></tr></thead>
                <tbody>
                  {shown.map((m) => (
                    <Fragment key={m.month}>
                      <tr className={cn("border-b border-border", m.total < 0 ? "bg-expense/5" : "bg-muted/20")}><td className={cn(td, "pl-5 font-semibold capitalize")}>{mName(m.month)}</td><td className={cn(td, "text-xs text-muted-foreground")}>{m.items.length ? `${m.items.length} fora do comum` : "só o de sempre"}</td><td /><td className={cn(td, "pr-5 text-right font-semibold tabular-nums", m.total >= 0 ? "text-income" : "text-expense")}>{m.total >= 0 ? "Sobra " : "Falta "}{money(Math.abs(m.total))}</td></tr>
                      {m.items.map((i) => (
                        <tr key={i.key} onClick={() => open(i)} className="cursor-pointer border-b border-border hover:bg-muted/30">
                          <td className={cn(td, "pl-8 tabular-nums text-muted-foreground")}>{i.date.slice(8)}/{i.date.slice(5, 7)}</td>
                          <td className={cn(td, "font-medium")}>{i.name}</td>
                          <td className={td}><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("h-3 w-3 rounded-full border-2", i.state === "agendado" ? "border-primary" : "border-dashed border-muted-foreground")} />{i.state === "agendado" ? "Agendado" : "Estimativa"}</span></td>
                          <td className={cn(td, "pr-5 text-right tabular-nums", i.type === "receita" ? "text-income" : "text-expense")}>{i.type === "receita" ? "+ " : "− "}{money(i.value)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-xs text-muted-foreground">Tocar num registro abre no Fluxo. Um registro novo também é salvo no Fluxo.</p>
            </Panel>
          </div>
        </>
      )}
    </DeskPage>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 animate-fade-up" data-testid="budget-projection">
      <BudgetHeader title="Projeção" subtitle="Pelo dinheiro que sai e entra na conta" month={month} setMonth={setMonth} />
      <div>{horizon}</div>
      {!view || !summary ? <FinnosPageLoading title="Calculando a projeção" description="Juntando o que você registrou no Fluxo." /> : (
        <>
          <section className={cn("rounded-[24px] p-5", summary.tone)}>
            <span className="text-xs font-bold uppercase tracking-wide">{summary.kicker}</span>
            <h2 className="mt-1.5 font-heading text-xl font-bold leading-tight">{summary.title}</h2>
            <p className="mt-1 text-sm text-foreground/80">{summary.text}</p>
            {meta}
          </section>
          <section className={card}><h2 className={cn(h2, "mb-3")}>Sobra de cada mês</h2>{bars}</section>
          <div><h2 className={h2}>O que pesa no caminho</h2><p className="mt-1 text-[13px] text-muted-foreground">As contas e os recebimentos que você registrou no Fluxo, e se cada mês fecha com sobra ou falta.</p></div>
          <div className="flex flex-col gap-2.5">{shown.map((m) => monthBlock(m, false))}</div>
          <p className="flex gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-primary" />agendado</span><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-dashed border-muted-foreground" />estimativa</span></p>
          <div className="grid grid-cols-2 gap-2"><Button size="lg" className="rounded-full" onClick={() => register("despesa")}>+ Conta futura</Button><Button size="lg" variant="outline" className="rounded-full" onClick={() => register("receita")}>+ A receber</Button></div>
          <p className="text-xs text-muted-foreground">{monthLabel(month)}: cada mês é o resultado de sempre ({money(view.base)}) mais o que está registrado no Fluxo.</p>
        </>
      )}
    </div>
  );
}
