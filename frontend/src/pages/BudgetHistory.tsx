/**
 * Orçamento · tela 7 (Histórico). Como foram os meses: sobra de cada um, entrou × saiu, e o histórico completo de um
 * mês (resumo, lançamentos do Fluxo, previsto × aconteceu e o que mudou depois do fechamento). Lê os fechamentos e
 * planos guardados na conta; os meses sem fechamento usam os números do Fluxo.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrends } from "@/lib/data";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { useBudgetClosings, useBudgetPlans } from "@/components/budget/usePlans";
import { buildHistory, forecastHits, savedByMonth, type HistoryState } from "@/lib/budget/history";
import { fetchMe } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { BulletBar } from "@/components/charts/FinnosCharts";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, h2, useBudgetMonth, useMoney } from "@/components/budget/shared";
import { DeskHeader, DeskPage, KpiStrip, Panel, Segmented, useIsDesktop } from "@/components/budget/desktop/kit";
import { cn } from "@/lib/utils";
import { MonthStory } from "@/components/budget/MonthStory";

const NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mName = (m: string) => NAMES[Number(m.slice(5)) - 1];

export default function BudgetHistory() {
  const last = addMonth(currentMonth(), -1);
  const [month, setMonth] = useBudgetMonth(last);
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const closings = useBudgetClosings();
  const plans = useBudgetPlans();
  const [filter, setFilter] = useState<"todos" | "fechado" | "aberto" | "desatualizado">("todos");
  const detailRef = useRef<HTMLDivElement>(null);
  const trends = useQuery({ queryKey: ["trends", 12, last], queryFn: () => fetchTrends(12, last) });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) });

  const months = useMemo(() => buildHistory(trends.data?.months ?? [], closings.closingOf, plans.planOf), [trends.data, closings, plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const closing = closings.closingOf(month);
  const pick = (m: string) => { setMonth(m); if (!desktop) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  const title = "Histórico do orçamento";
  if (!trends.data) {
    const l = <FinnosPageLoading title="Carregando o histórico" description="Juntando os meses fechados." />;
    return desktop ? <DeskPage testId="budget-history"><DeskHeader title={title} month={month} setMonth={setMonth} />{l}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={title} subtitle="Como foram os últimos meses" month={month} setMonth={setMonth} />{l}</div>;
  }
  if (!months.length) {
    const empty = <section className={card}><h2 className={h2}>Ainda não há meses para contar</h2><p className="mt-1 text-sm text-muted-foreground">Quando o primeiro mês com lançamentos terminar, ele aparece aqui. Feche o mês no Orçamento para guardar o retrato.</p></section>;
    return desktop ? <DeskPage testId="budget-history"><DeskHeader title={title} month={month} setMonth={setMonth} />{empty}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4" data-testid="budget-history"><BudgetHeader title={title} subtitle="Como foram os últimos meses" month={month} setMonth={setMonth} />{empty}</div>;
  }

  const max = Math.max(1, ...months.map((m) => Math.abs(m.result)));
  const bars = (
    <div>
      <div className="flex h-40 gap-1.5">
        {months.map((m) => (
          <button key={m.month} type="button" onClick={() => pick(m.month)} aria-pressed={m.month === month} aria-label={`${mName(m.month)}: ${m.result >= 0 ? "sobrou" : "faltou"} ${money(Math.abs(m.result))}`} className={cn("flex flex-1 flex-col rounded-md", months.length < 6 && "mx-auto max-w-16", m.month === month && "bg-primary/10")}>
            <span className="flex flex-1 items-end border-b border-muted-foreground/50 px-[14%]"><span className="block w-full rounded-t" style={{ height: m.result > 0 ? `${(m.result / max) * 100}%` : 0, backgroundColor: m.month === month ? "var(--finnos-purple)" : "color-mix(in srgb, var(--finnos-purple) 32%, var(--background))" }} /></span>
            <span className="flex flex-1 items-start px-[14%]"><span className="block w-full rounded-b" style={{ height: m.result < 0 ? `${(-m.result / max) * 100}%` : 0, backgroundColor: m.month === month ? "var(--expense)" : "color-mix(in srgb, var(--expense) 35%, var(--background))" }} /></span>
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-center text-[10px] text-muted-foreground">{months.map((m) => <span key={m.month} className={cn("flex-1", months.length < 6 && "mx-auto max-w-16")}>{mName(m.month).slice(0, 3)}</span>)}</div>
      <p className="mt-2 text-xs text-muted-foreground">Acima da linha sobrou, abaixo faltou. Toque num mês para abrir.</p>
    </div>
  );
  const peak = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  const worst = months.filter((m) => m.result < 0);
  const inout = (
    <ul className="flex flex-col gap-2">
      {months.slice(-6).map((m) => (
        <li key={m.month} className="flex items-center gap-2 text-xs">
          <span className="w-8 text-muted-foreground">{mName(m.month).slice(0, 3)}</span>
          <span className="flex flex-1 flex-col gap-0.5"><span className="h-2 rounded-full bg-income" style={{ width: `${(m.income / peak) * 100}%` }} /><span className="h-2 rounded-full bg-expense" style={{ width: `${(m.expense / peak) * 100}%` }} /></span>
        </li>
      ))}
      <li className="mt-1 flex gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-income" />Entrou</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-expense" />Saiu</span></li>
      <li className="text-xs text-muted-foreground">{worst.length ? `${worst.length === 1 ? `${mName(worst[0].month)} foi o único mês` : `${worst.length} meses`} em que saiu mais do que entrou.` : "Em todos os meses entrou mais do que saiu."}</li>
    </ul>
  );

  const BADGE: Record<HistoryState, string> = { fechado: "bg-income/10 text-income", aberto: "bg-muted text-muted-foreground", desatualizado: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" };
  const LABEL: Record<HistoryState, string> = { fechado: "Fechado", aberto: "Aberto", desatualizado: "Desatualizado" };
  const shown = [...months].reverse().filter((m) => filter === "todos" || m.state === filter);
  const list = (
    <div className="space-y-2">
      <Segmented label="Filtrar meses" value={filter} onChange={setFilter} options={[["todos", "Todos"], ["fechado", "Fechados"], ["aberto", "Abertos"], ["desatualizado", "Desatualizados"]] as const} />
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border" data-testid="history-list">
        {shown.map((m) => (
          <li key={m.month}>
            <button type="button" onClick={() => pick(m.month)} aria-current={m.month === month ? "true" : undefined} className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40", m.month === month && "bg-primary/[0.06]")}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><strong className="text-sm">{monthLabel(m.month)}</strong><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", BADGE[m.state])}>{LABEL[m.state]}</span></span>
                <span className="block truncate text-xs text-muted-foreground">{m.result >= 0 ? `Sobrou ${money(m.result)}` : `Faltou ${money(-m.result)}`}{m.saved ? ` · guardou ${money(m.saved)}` : ""}{m.withinLimits === true ? " · tudo no limite" : m.over.length ? ` · passou: ${m.over.slice(0, 2).join(", ")}` : ""}</span>
              </span>
            </button>
          </li>
        ))}
        {!shown.length ? <li className="px-4 py-5 text-center text-sm text-muted-foreground">Nenhum mês nesse filtro.</li> : null}
      </ul>
    </div>
  );

  const ids = months.map((m) => m.month);
  const hits = forecastHits(ids, closings.closingOf);
  const savedRows = savedByMonth(ids, goals.data ?? [], plans.planOf).slice(-6);
  const forecast = hits.rows.length ? (
    <div className="space-y-2.5" data-testid="history-forecast">
      {hits.rows.slice(-6).map((r) => (
        <div key={r.month} className="flex items-center gap-2 text-xs">
          <span className="w-8 text-muted-foreground">{mName(r.month).slice(0, 3)}</span>
          <span aria-hidden="true" className="flex h-2.5 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted"><span className="bg-primary" style={{ width: `${(r.hit / r.total) * 100}%` }} /><span className="bg-expense" style={{ width: `${(r.miss / r.total) * 100}%` }} /></span>
          <strong className="w-9 text-right tabular-nums">{Math.round((r.pct ?? 0) * 100)}%</strong>
        </div>
      ))}
      <div className="flex gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />aconteceu</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-expense" />não aconteceu até o fechamento</span></div>
      <p className="text-xs text-muted-foreground">{hits.worst ? `${hits.worst.name} é o previsto que mais falha: não aconteceu em ${hits.worst.missed} de ${hits.worst.times} meses.` : "Nenhum previsto falhou em mais de um mês."}</p>
    </div>
  ) : <p className="text-xs text-muted-foreground">Aparece a partir do próximo fechamento: ao fechar o mês, o Orçamento guarda o que estava previsto e se aconteceu.</p>;
  const savedChart = (
    <div className="space-y-2.5" data-testid="history-saved">
      {savedRows.map((r) => (
        <div key={r.month} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 text-xs">
          <span className="text-muted-foreground">{mName(r.month).slice(0, 3)}</span>
          {r.planned > 0 ? <BulletBar value={r.saved} limit={r.planned} format={money} /> : <span className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, (r.saved / Math.max(1, ...savedRows.map((x) => x.saved))) * 100)}%` }} />}
          <strong className="tabular-nums">{money(r.saved)}</strong>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{savedRows.some((r) => r.planned > 0) ? "Barra = guardado em Metas · marca = o que o plano previa." : "Aportes registrados em Metas. Planeje quanto guardar em cada mês para comparar."}</p>
    </div>
  );

  const detailBody = <MonthStory key={month} month={month} money={money} desktop={desktop} />;
  const closed = months.filter((m) => m.state !== "aberto");
  const stale = months.filter((m) => m.state === "desatualizado").length;
  const saved = months.reduce((s, m) => s + m.saved, 0), savedPlanned = months.reduce((s, m) => s + m.savedPlanned, 0);
  const within = closed.filter((m) => m.withinLimits).length;
  const totalResult = months.reduce((s, m) => s + m.result, 0);
  const kpis = [
    { label: "Sobra no período", value: money(totalResult), tone: totalResult < 0 ? "expense" as const : undefined, hint: `${months.length} ${months.length === 1 ? "mês" : "meses"} · média de ${money(totalResult / months.length)}` },
    { label: "Guardado em metas", value: money(saved), hint: savedPlanned ? `plano: ${money(savedPlanned)}` : "no fechamento de cada mês" },
    { label: "No limite", value: closed.length ? `${within} de ${closed.length}` : "—", hint: closed.length ? "meses fechados" : "feche um mês para ver" },
    { label: "Fechados", value: `${closed.length} de ${months.length}`, hint: stale ? `${stale} ${stale === 1 ? "desatualizado" : "desatualizados"}` : "nenhum desatualizado", tone: stale ? "expense" as const : undefined },
  ];
  const head = `${monthLabel(month)} · ${closing ? (months.find((m) => m.month === month)?.state === "desatualizado" ? "desatualizado" : "fechado") : "não fechado"}`;

  if (desktop) return (
    <DeskPage testId="budget-history">
      <DeskHeader title={title} month={month} setMonth={setMonth} />
      <KpiStrip items={kpis} />
      <div className="grid grid-cols-12 items-start gap-5">
        <div className="col-span-4 flex flex-col gap-5"><Panel title="Meses">{list}</Panel><Panel title="Sobra por mês">{bars}</Panel><Panel title="Entrou × saiu">{inout}</Panel><Panel title="Previsto que aconteceu">{forecast}</Panel><Panel title="Guardado por mês">{savedChart}</Panel></div>
        <Panel title={head} className="col-span-8" testId="history-month">{detailBody}</Panel>
      </div>
    </DeskPage>
  );
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 animate-fade-up" data-testid="budget-history">
      <BudgetHeader title={title} subtitle="Planos e fechamentos dos últimos meses" month={month} setMonth={setMonth} />
      <div className="grid grid-cols-2 gap-2">{kpis.map((k) => <div key={k.label} className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">{k.label}</span><strong className={cn("block font-heading text-[15px] tabular-nums", k.tone === "expense" && "text-expense")}>{k.value}</strong><span className="block truncate text-[11px] text-muted-foreground">{k.hint}</span></div>)}</div>
      <section className={card}><h2 className={cn(h2, "mb-3")}>Meses</h2>{list}</section>
      <section className={card}><h2 className={cn(h2, "mb-3")}>Sobra por mês</h2>{bars}</section>
      <section className={card}><h2 className={cn(h2, "mb-3")}>Entrou × saiu</h2>{inout}</section>
      <section className={card}><h2 className={cn(h2, "mb-3")}>Previsto que aconteceu</h2>{forecast}</section>
      <section className={card}><h2 className={cn(h2, "mb-3")}>Guardado por mês</h2>{savedChart}</section>
      <section ref={detailRef} className={cn(card, "scroll-mt-4")} data-testid="history-month"><h2 className={cn(h2, "mb-3")}>{head}</h2>{detailBody}</section>
    </div>
  );
}
