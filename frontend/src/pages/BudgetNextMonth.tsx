/**
 * Orçamento · tela 3 (Planejar o próximo mês). The person decides what comes in, what is paid, what is kept in metas and
 * the day-to-day limits. Only the Orçamento's own things are saved here (the review of the month, planned savings on the
 * device, and the limits in the budget cycle). New forecasts open the Fluxo form; metas are confirmed in Metas.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { createBudgetCycle, fetchBudget, fetchCards, fetchCategories, fetchCurrentBudgetCycle, fetchFlow, fetchMe, fetchNextBudgetCycle, fetchTrends, updateBudgetCycle, type BudgetCyclePayload } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { buildNextMonthPlan, toggleDecision, type PlanRow, type PlanTone } from "@/lib/budget/nextMonth";
import { useBudgetPlans, useBudgetSpecials } from "@/components/budget/usePlans";
import { SpecialsInMonth } from "@/components/budget/SpecialsInMonth";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BulletBar, SegmentedBar } from "@/components/charts/FinnosCharts";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, card, h2, useBudgetMonth, useMoney } from "@/components/budget/shared";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/components/budget/desktop/kit";
import { NextMonthDesktop } from "@/components/budget/desktop/NextMonthDesktop";
import type { Category } from "@/types/finnos";

const TONE: Record<PlanTone, { label: string; cls: string; text: string }> = {
  "nao-fecha": { label: "Não fecha", cls: "bg-expense/10 text-expense", text: "text-expense" },
  atencao: { label: "Atenção", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-200", text: "text-amber-700 dark:text-amber-300" },
  pode: { label: "Pode gastar", cls: "bg-income/10 text-income", text: "text-income" },
};
const GOAL_COLORS = ["var(--finnos-purple)", "var(--finnos-violet)", "#B3A6FF", "#070F52"];

export default function BudgetNextMonth() {
  const [month, setMonth] = useBudgetMonth(addMonth(currentMonth(), 1));
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const short = monthLabel(month).split(" ")[0].toLowerCase();
  // The plan as saved (server, or the device copy when offline) and a draft of what is being changed here.
  const plans = useBudgetPlans();
  const stored = plans.planOf(month);
  const [draft, setDraft] = useState<{ approved: string[]; ignored: string[]; saving: Record<string, number>; specials?: string[] } | null>(null);
  const review = draft ?? stored;
  const save = review.saving;
  const setReview = (next: { approved: string[]; ignored: string[] }) => setDraft({ ...review, ...next });
  const specials = useBudgetSpecials();
  const included = review.specials ?? [];
  const toggleSpecial = (id: string, on: boolean) => setDraft({ ...review, specials: on ? [...included.filter((x) => x !== id), id] : included.filter((x) => x !== id) });
  const specialsBlock = <SpecialsInMonth month={month} specials={specials.all} included={included} onToggle={toggleSpecial} money={money} />;
  const setSave = (fn: (cur: Record<string, number>) => Record<string, number>) => setDraft({ ...review, saving: fn(review.saving) });
  const [limits, setLimits] = useState<Record<string, number> | null>(null);
  useEffect(() => { setDraft(null); setLimits(null); }, [month]);

  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const flow = useQuery({ queryKey: ["flow", "orcamento", month], queryFn: () => fetchFlow({ month, months: 1 }) });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) });
  const trends = useQuery({ queryKey: ["trends", 3, addMonth(month, -2)], queryFn: () => fetchTrends(3, addMonth(month, -2)) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const current = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, retry: false });
  const next = useQuery({ queryKey: ["budget-v2-next"], queryFn: fetchNextBudgetCycle, retry: false });
  const past = useQueries({ queries: [1, 2, 3].map((n) => { const m = addMonth(month, -n - 1); return { queryKey: ["budget", m], queryFn: () => fetchBudget(m) }; }) });

  const habit = useMemo(() => { const ms = (trends.data?.months ?? []).filter((m) => m.expense > 0); return ms.length ? ms.reduce((s, m) => s + m.expense, 0) / ms.length : 0; }, [trends.data]);
  const plan = useMemo(() => (flow.data && cards.data ? buildNextMonthPlan({ month, flow: flow.data, cards: cards.data, approved: review.approved, ignored: review.ignored, save, habit }) : null), [month, flow.data, cards.data, review, save, habit]);

  // Limits: the cycle that covers the month, else the current one, else each category's default.
  const covering = [next.data, current.data].find((c) => c && c.start_date.slice(0, 7) <= month && c.end_date.slice(0, 7) >= month) ?? null;
  const spendCats = useMemo(() => (cats.data ?? []).filter((c) => c.group !== "metas" && c.name !== "Renda"), [cats.data]);
  const baseLimits = useMemo(() => {
    const from = covering ?? current.data ?? null;
    return Object.fromEntries(spendCats.map((c) => [c.id, from?.allocations.find((a) => a.category_id === c.id)?.planned ?? c.monthly_budget ?? 0]));
  }, [covering, current.data, spendCats]);
  const lim = limits ?? baseLimits;
  const avg = useMemo(() => {
    const out: Record<string, number> = {};
    const done = past.filter((q) => q.data);
    for (const q of done) for (const r of q.data!.rows) out[r.category_id] = (out[r.category_id] ?? 0) + r.spent / done.length;
    return out;
  }, [past]);
  const limitRows = spendCats.filter((c) => (lim[c.id] ?? 0) > 0 || (avg[c.id] ?? 0) > 0);
  const limitsTotal = limitRows.reduce((s, c) => s + (lim[c.id] ?? 0), 0);

  const decide = (row: PlanRow) => {
    const d = toggleDecision(row);
    const approved = review.approved.filter((k) => k !== row.key), ignored = review.ignored.filter((k) => k !== row.key);
    if (d === "approve") approved.push(row.key);
    if (d === "ignore") ignored.push(row.key);
    setReview({ approved, ignored });
  };
  const goalList = goals.data ?? [];
  const setGoal = (id: string, v: number) => setSave((cur) => ({ ...cur, [id]: Math.max(0, v) }));
  const preset = (kind: "gastar" | "equilibrado" | "guardar") => setSave(() => Object.fromEntries(goalList.map((g) => [g.id, kind === "gastar" ? 0 : Math.round((g.contribution || 0) * (kind === "guardar" ? 2 : 1))])));
  const forecast = (type: "receita" | "despesa") => dialogs.openTransaction({ type, date: `${month}-15`, prefill: { status: "pendente" } });

  const saveCycle = useMutation({
    mutationFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const allocations = spendCats.filter((c) => (lim[c.id] ?? 0) > 0).map((c) => ({ category_id: c.id, planned: lim[c.id], priority: (c.group === "necessidades" ? "essencial" : "flexivel") as "essencial" | "flexivel", rollover: covering?.allocations.find((a) => a.category_id === c.id)?.rollover ?? false }));
      const own = covering && covering.period === "mensal" && covering.start_date.slice(0, 7) === month ? covering : null;
      // Allocations of the metas group stay as they were: keeping money is Metas' job.
      const kept = (own?.allocations ?? []).filter((a) => !spendCats.some((c) => c.id === a.category_id)).map(({ category_id, planned, priority, rollover }) => ({ category_id, planned, priority, rollover }));
      const payload: BudgetCyclePayload = { mode: own?.mode ?? "personalizado", period: "mensal", start_date: `${month}-01`, end_date: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`,
        expected_income: plan?.inTotal ?? 0, allocations: [...allocations, ...kept], extraordinary: own?.extraordinary ?? false, notes: own?.notes ?? null };
      return own ? updateBudgetCycle(own.id, payload) : createBudgetCycle(payload);
    },
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["budget-v2-current"] }), qc.invalidateQueries({ queryKey: ["budget-v2-next"] }), qc.invalidateQueries({ queryKey: ["budget-v2-history"] })]); },
  });
  const savePlan = async () => {
    if (plan) {
      try {
        await plans.save.mutateAsync({ ...stored, month, approved: review.approved, ignored: review.ignored, saving: save, specials: included,
          expected: { ...(stored.expected ?? {}), ...Object.fromEntries([...plan.incomes, ...plan.bills].filter((r) => r.on && r.key.startsWith("tx:")).map((r) => [r.key, r.value])) },
          planned_income: plan.inTotal, planned_bills: plan.billTotal, planned_saving: plan.saveTotal, planned_spend: plan.spend });
        setDraft(null);
      } catch { return; }
    }
    if (limits) {
      try { await saveCycle.mutateAsync(); } catch (e) { toast.error(`O plano ficou salvo neste aparelho, mas os limites não: ${getApiErrorMessage(e)}`); return; }
    }
    toast.success(`Plano de ${short} salvo. Os aportes vão para Metas quando você confirmar.`);
  };

  if (desktop) return <NextMonthDesktop month={month} setMonth={setMonth} short={short} money={money} plan={plan} goals={goalList} save={save} setGoal={setGoal} preset={preset}
    limitRows={limitRows} lim={lim} avg={avg} setLimit={(id, v) => setLimits({ ...lim, [id]: v })} limitsTotal={limitsTotal} limitsChanged={!!limits}
    decide={decide} forecast={forecast} savePlan={savePlan} saving={saveCycle.isPending} specials={specials.all.some((s) => s.start.slice(0, 7) <= month && s.end.slice(0, 7) >= month) ? specialsBlock : null} />;
  if (!plan) return <div className="mx-auto w-full max-w-[1240px] space-y-5"><BudgetHeader title={`Planejar ${short}`} subtitle="Você decide: o que entra, o que paga e o que guarda" month={month} setMonth={setMonth} /><FinnosPageLoading title="Carregando o plano" description="Juntando o que está previsto no Fluxo." /></div>;
  const tone = TONE[plan.tone];
  const SaveButton = () => (
    <div>
      <button type="button" onClick={savePlan} disabled={saveCycle.isPending} className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full")} data-testid="next-save">{saveCycle.isPending ? "Salvando…" : `Salvar plano de ${short}`}</button>
      <p className="mt-2 text-center text-xs text-muted-foreground">Nada é lançado na Carteira. Os aportes vão para Metas quando você confirmar.</p>
    </div>
  );
  const goalSegments = goalList.filter((g) => (save[g.id] ?? 0) > 0).map((g, i) => ({ value: save[g.id], color: GOAL_COLORS[i % GOAL_COLORS.length], label: g.name }));

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-5 animate-fade-up" data-testid="budget-next">
      <BudgetHeader title={`Planejar ${short}`} subtitle="Você decide: o que entra, o que paga e o que guarda" month={month} setMonth={setMonth} />
      <section aria-label="Resultado" className={cn(card, "grid grid-cols-1 gap-5 lg:grid-cols-12")} data-testid="next-result">
        <div className="lg:col-span-5">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-muted-foreground">Para gastar em {short}</p><span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", tone.cls)}>{tone.label}</span></div>
          <p className={cn("mt-1.5 font-heading text-5xl font-bold tracking-tight tabular-nums", tone.text)} data-testid="next-spend">{money(plan.spend)}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {plan.tone === "nao-fecha" ? `Faltam ${money(-plan.spend)}. Tire uma conta, guarde menos ou preveja uma entrada.` : plan.tone === "atencao" ? `Abaixo do que você costuma gastar no mês (${money(plan.habit)}). Dá, mas vai ser apertado.` : plan.habit ? `Acima do seu gasto médio de ${money(plan.habit)}: ${short} fecha com folga.` : "Ainda não há meses suficientes para comparar com o seu gasto médio."}
          </p>
          {limitsTotal > 0 ? <p className={cn("mt-2 text-xs", limitsTotal > plan.spend ? "text-expense" : "text-muted-foreground")}>Limites do dia a dia somam {money(limitsTotal)}{limitsTotal > plan.spend ? `: ${money(limitsTotal - plan.spend)} acima do que sobra para gastar.` : "."}</p> : null}
        </div>
        <ul className="rounded-2xl border border-border p-3.5 text-[13px] lg:col-span-4">
          <li className="flex justify-between"><span className="text-muted-foreground">Vai entrar</span><strong className="tabular-nums text-income">+ {money(plan.inTotal)}</strong></li>
          <li className="mt-1.5 flex justify-between"><span className="text-muted-foreground">Compromissos</span><strong className="tabular-nums">− {money(plan.billTotal)}</strong></li>
          <li className="mt-1.5 flex justify-between"><span className="text-muted-foreground">Metas</span><strong className="tabular-nums">− {money(plan.saveTotal)}</strong></li>
          <li className="mt-2 flex justify-between border-t border-border pt-2"><strong>Para gastar</strong><strong className={cn("tabular-nums", tone.text)}>{money(plan.spend)}</strong></li>
        </ul>
        <div className="flex flex-col justify-between gap-3 lg:col-span-3">
          <p className="text-xs leading-relaxed text-muted-foreground">O Orçamento só junta o que já existe: contas e receitas vêm do Fluxo, faturas da Carteira, assinaturas de Assinaturas e metas de Metas. O que você prevê aqui é salvo no Fluxo como estimativa.</p>
          <SaveButton />
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <div className="contents">
          <PlanList n={1} title="O que vai entrar" total={money(plan.inTotal)} totalCls="text-income" rows={plan.incomes} money={money} onToggle={decide} add="Prever uma entrada" onAdd={() => forecast("receita")} month={month} />
          <section aria-label="O que fazer com o resto" className={cn(card, "order-3")} data-testid="next-rest">
            <div className="flex items-baseline justify-between gap-2"><h2 className={h2}>3 · O que fazer com o resto</h2><strong className="text-sm tabular-nums">{money(plan.rest)}</strong></div>
            <p className="mt-1 text-[13px] text-muted-foreground">Depois de pagar tudo, sobram {money(plan.rest)}. Divida entre gastar e guardar. O que for guardado vai para uma meta em Metas.</p>
            {goalList.length ? (
              <>
                <div role="radiogroup" aria-label="Jeito de dividir" className="mt-3 grid grid-cols-3 gap-1.5">
                  {([["gastar", "Gastar mais"], ["equilibrado", "Equilibrado"], ["guardar", "Guardar mais"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => preset(k)} className="h-10 rounded-full border border-border bg-card text-xs font-bold hover:border-primary">{l}</button>)}
                </div>
                <SegmentedBar className="mt-4" height={14} format={money} segments={[{ value: Math.max(0, plan.spend), color: "var(--income)", label: "Gastar" }, ...goalSegments]} />
                <ul className="mt-2">
                  <li className="flex items-center gap-2.5 py-2.5 text-sm"><span className="h-3 w-3 rounded bg-income" /><span className="flex-1"><strong>Gastar</strong><span className="block text-xs text-muted-foreground">Dia a dia: mercado, lazer, transporte</span></span><strong className={cn("w-28 text-right tabular-nums", tone.text)}>{money(plan.spend)}</strong></li>
                  {goalList.map((g, i) => (
                    <li key={g.id} className="flex items-center gap-2.5 border-t border-border py-2.5 text-sm">
                      <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: GOAL_COLORS[i % GOAL_COLORS.length] }} />
                      <span className="min-w-0 flex-1"><strong className="block truncate">{g.name}</strong><span className="text-xs text-muted-foreground">Faltam {money(Math.max(0, g.target - g.saved))}{g.contribution ? ` · plano de ${money(g.contribution)}/mês` : ""}</span></span>
                      <button type="button" onClick={() => setGoal(g.id, (save[g.id] ?? 0) - 50)} aria-label={`Menos para ${g.name}`} className="grid h-8 w-8 place-items-center rounded-full border border-border">−</button>
                      <strong className="w-24 text-center tabular-nums">{money(save[g.id] ?? 0)}</strong>
                      <button type="button" onClick={() => setGoal(g.id, (save[g.id] ?? 0) + 50)} aria-label={`Mais para ${g.name}`} className="grid h-8 w-8 place-items-center rounded-full border border-border">+</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-3 rounded-xl bg-muted/60 p-3 text-[13px]">Você ainda não tem metas. Guardar dinheiro é sempre numa meta. <Link to="/metas" className="font-semibold text-primary">Criar uma meta</Link></p>}
          </section>
        </div>
        <div className="contents">
          <PlanList n={2} title="Meus compromissos" hint="Toque no círculo para incluir ou tirar uma conta deste mês." total={money(plan.billTotal)} rows={plan.bills} money={money} onToggle={decide} add={`Prever uma conta para ${short}`} onAdd={() => forecast("despesa")} month={month} />


        </div>
      </div>

          {specials.all.some((s) => s.start.slice(0, 7) <= month && s.end.slice(0, 7) >= month) ? <section aria-label="Planos especiais" className={card}><h2 className={cn(h2, "mb-2")}>Planos especiais neste mês</h2>{specialsBlock}</section> : null}
          <section aria-label="Limites do dia a dia" className={card} data-testid="next-limits">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className={h2}>4 · Limites do dia a dia</h2><span className="text-xs text-muted-foreground">Barra = média dos 3 últimos meses · marca = limite</span></div>
            <ul className="mt-3 flex flex-col gap-3.5">
              {limitRows.map((c: Category) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <strong className="w-32 shrink-0 truncate text-sm">{c.name}</strong>
                  <div className="min-w-[160px] flex-1"><BulletBar value={avg[c.id] ?? 0} limit={lim[c.id] ?? 0} format={money} /></div>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => setLimits({ ...lim, [c.id]: Math.max(0, (lim[c.id] ?? 0) - 50) })} aria-label={`Diminuir limite de ${c.name}`} className="grid h-8 w-8 place-items-center rounded-full border border-border">−</button>
                    <strong className="w-24 text-center text-sm tabular-nums">{money(lim[c.id] ?? 0)}</strong>
                    <button type="button" onClick={() => setLimits({ ...lim, [c.id]: (lim[c.id] ?? 0) + 50 })} aria-label={`Aumentar limite de ${c.name}`} className="grid h-8 w-8 place-items-center rounded-full border border-border">+</button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Média de {money(Math.round(limitRows.reduce((s, c) => s + (avg[c.id] ?? 0), 0)))} por mês nessas categorias. {limits ? "Os novos limites são salvos com o plano." : "Ajuste com − e +; nada muda até salvar o plano."}</p>
          </section>
      <SaveButton />
    </div>
  );
}

function PlanList({ n, title, hint, total, totalCls, rows, money, onToggle, add, onAdd, month }: {
  n: number; title: string; hint?: string; total: string; totalCls?: string; rows: PlanRow[]; money: (v: number) => string;
  onToggle: (r: PlanRow) => void; add: string; onAdd: () => void; month: string;
}) {
  const MON = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"][Number(month.slice(5)) - 1];
  return (
    <section aria-label={title} className={cn(card, n === 1 ? "order-1" : "order-2")} data-testid={`next-list-${n}`}>
      <div className="flex items-baseline justify-between gap-2"><h2 className={h2}>{n} · {title}</h2><strong className={cn("text-sm tabular-nums", totalCls)}>{total}</strong></div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <ul className="mt-3 overflow-hidden rounded-2xl border border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0" data-testid="plan-row" data-on={r.on}>
            <span className={cn("grid h-12 w-11 shrink-0 place-content-center rounded-xl bg-muted/70 text-center", !r.on && "text-muted-foreground")}><strong className="font-heading text-base leading-none">{r.date.slice(8)}</strong><span className="mt-1 text-[10px] font-bold tracking-wide">{MON}</span></span>
            <span className="min-w-0 flex-1"><strong className={cn("block truncate text-sm", !r.on && "text-muted-foreground")}>{r.name}</strong><span className="text-xs text-muted-foreground">{r.on || r.origin === "sugestao" ? r.note : "Fora deste mês · continua no Fluxo"}</span></span>
            <strong className={cn("text-sm tabular-nums", !r.on ? "text-muted-foreground" : r.type === "receita" && "text-income")}>{r.type === "receita" ? "+ " : ""}{money(r.value)}</strong>
            <button type="button" onClick={() => onToggle(r)} aria-pressed={r.on} aria-label={`${r.on ? "Tirar" : "Incluir"} ${r.name}`} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", r.on ? "bg-primary text-primary-foreground" : "border-2 border-border")}>{r.on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}</button>
          </li>
        ))}
        <li><button type="button" onClick={onAdd} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-sm font-bold text-primary"><span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10"><Plus className="h-4 w-4" /></span>{add}</button></li>
      </ul>
      {rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nada previsto ainda. O que você prever é salvo no Fluxo como estimativa.</p> : null}
    </section>
  );
}
