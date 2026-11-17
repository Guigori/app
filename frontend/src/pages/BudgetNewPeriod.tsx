/**
 * Orçamento · Começar o período. Numa página só, na ordem em que se decide:
 * a regra do período (50/30/20, personalizado ou proporção que soma 100%), o que vai entrar (e como isso se divide),
 * o que vai sair, guardar ou cortar, os limites do dia a dia, lembretes e a revisão com o calendário e quanto sobra
 * se o orçamento for seguido. "Começar" guarda o ciclo (datas e limites) e o plano do mês (o que foi incluído, metas
 * e lembretes), mostra o concluído e volta ao Orçamento. Estimativas novas são feitas no formulário do Fluxo.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createBudgetCycle, fetchBudget, fetchCards, fetchCategories, fetchCurrentBudgetCycle, fetchFlow, fetchMe, fetchNextBudgetCycle, fetchSubscriptions, fetchTransactions, updateBudgetCycle, type BudgetCyclePayload } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, currentMonth, monthLabel, todayISO } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { buildNextMonthPlan, toggleDecision, type PlanRow } from "@/lib/budget/nextMonth";
import { cycleDates, limitChanges, limitsForBase, type PeriodBase, type PeriodCycle } from "@/lib/budget/newPeriod";
import { suggestEstimates } from "@/lib/budget/closing";
import { monthOutlook, reviewSubscriptions, savingIdeas, suggestReminders } from "@/lib/budget/review";
import { splitLabel, useBudgetSettings, validSplit, type BudgetSplit } from "@/lib/budget/prefs";
import type { PlanReminder } from "@/lib/budget/server";
import { useBudgetClosings, useBudgetPlans, useBudgetSpecials } from "@/components/budget/usePlans";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, useBudgetMonth, useMoney, useMonthData } from "@/components/budget/shared";
import { DeskHeader, DeskPage, Panel, Segmented, useIsDesktop } from "@/components/budget/desktop/kit";
import { MonthAgenda } from "@/components/budget/MonthAgenda";
import { BudgetSuccess } from "@/components/budget/BudgetSuccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MON = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const CYCLES = [["1", "Dia 1 ao fim"], ["5", "Dia 5 ao 4"], ["c", "Escolher"]] as const;
type Rule = "503020" | "personalizado" | "proporcao";
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Switch({ on, onClick, label }: { on: boolean; onClick?: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted")}>
      <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}
function Section({ title, hint, children, action, id, className }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode; id?: string; className?: string }) {
  return <div id={id} className={cn("scroll-mt-4", className)}><Panel title={title} action={action}>{hint ? <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">{hint}</p> : null}{children}</Panel></div>;
}

export default function BudgetNewPeriod() {
  const [month, setMonth] = useBudgetMonth(addMonth(currentMonth(), 1));
  const short = monthLabel(month).split(" ")[0].toLowerCase();
  const Short = short.charAt(0).toUpperCase() + short.slice(1);
  const today = todayISO();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const [settings, setSettings] = useBudgetSettings();
  const plans = useBudgetPlans();
  const closings = useBudgetClosings();
  const specials = useBudgetSpecials();
  const stored = plans.planOf(month);
  const before = plans.planOf(addMonth(month, -1));
  // Where the accounts start: the end of the current month as projected today (or today's balance).
  const nowView = useMonthData(currentMonth()).view;

  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const flow = useQuery({ queryKey: ["flow", "orcamento", month], queryFn: () => fetchFlow({ month, months: 1 }) });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) });
  const current = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, retry: false });
  const nextCycle = useQuery({ queryKey: ["budget-v2-next"], queryFn: fetchNextBudgetCycle, retry: false });
  const past = useQueries({ queries: [1, 2].map((n) => { const m = addMonth(month, -n); return { queryKey: ["budget", m], queryFn: () => fetchBudget(m) }; }) });
  const pastTx = useQueries({ queries: [1, 2, 3].map((n) => { const m = addMonth(month, -n); return { queryKey: ["transactions", { month: m }], queryFn: () => fetchTransactions({ month: m }) }; }) });

  const [rule, setRule] = useState<Rule>(() => (settings.split ? "proporcao" : "personalizado"));
  const [split, setSplit] = useState<BudgetSplit>(() => settings.split ?? { necessidades: 50, desejos: 30, futuro: 20 });
  const [start, setStart] = useState<"anterior" | "novo" | `modelo:${string}`>("anterior");
  const [cycle, setCycle] = useState<PeriodCycle>("1");
  const [custom, setCustom] = useState(() => cycleDates(month, "1"));
  const [review, setReview] = useState<{ approved: string[]; ignored: string[] } | null>(null);
  const [withSpecials, setWithSpecials] = useState<string[] | null>(null);
  const [savingDraft, setSavingDraft] = useState<Record<string, number> | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [rem, setRem] = useState<PlanReminder[] | null>(null);
  const [newRem, setNewRem] = useState({ date: "", text: "" });
  const [success, setSuccess] = useState(false);
  useEffect(() => { setReview(null); setWithSpecials(null); setSavingDraft(null); setEdits({}); setRem(null); setSuccess(false); setCustom(cycleDates(month, "1")); }, [month]);

  const decisions = review ?? { approved: stored.approved, ignored: stored.ignored };
  const goalList = goals.data ?? [];
  const prevSaving = Object.keys(stored.saving ?? {}).length ? stored.saving : before.saving ?? {};
  const saving = savingDraft ?? Object.fromEntries(Object.entries(prevSaving).filter(([id]) => goalList.some((g) => g.id === id)));
  const plan = useMemo(() => (flow.data && cards.data ? buildNextMonthPlan({ month, flow: flow.data, cards: cards.data, approved: decisions.approved, ignored: decisions.ignored, save: saving, habit: 0 }) : null),
    [month, flow.data, cards.data, decisions, saving]); // eslint-disable-line react-hooks/exhaustive-deps
  const reminders = rem ?? stored.reminders ?? [];

  const spendCats = useMemo(() => (cats.data ?? []).filter((c) => c.group !== "metas" && c.name !== "Renda"), [cats.data]);
  const names = useMemo(() => Object.fromEntries(spendCats.map((c) => [c.id, c.name])), [spendCats]);
  const nowLimits = useMemo(() => {
    const from = current.data ?? null;
    return Object.fromEntries(spendCats.map((c) => [c.id, from?.allocations.find((a) => a.category_id === c.id)?.planned ?? c.monthly_budget ?? 0]).filter(([, v]) => (v as number) > 0)) as Record<string, number>;
  }, [current.data, spendCats]);
  const model = start.startsWith("modelo:") ? settings.models.find((m) => `modelo:${m.id}` === start) ?? null : null;
  const splitSum = split.necessidades + split.desejos + split.futuro;
  const splitOk = validSplit({ ...split });
  // The rule decides where the limits start: 50/30/20 and the proportion split the income; personalizado starts from
  // today's limits, a saved model or zero.
  const base: PeriodBase = rule === "503020" ? "503020" : rule === "proporcao" ? "proprio" : model ? "modelo" : start === "novo" ? "novo" : "anterior";
  const baseLimits = useMemo(() => limitsForBase(base, { categories: spendCats, current: nowLimits, income: plan?.inTotal ?? 0, model: model?.limits, split: splitOk ? split : null }), [base, spendCats, nowLimits, plan?.inTotal, model, split, splitOk]);
  const limits = useMemo(() => Object.fromEntries(Object.entries({ ...baseLimits, ...edits }).filter(([, v]) => v > 0)), [baseLimits, edits]);
  const changes = limitChanges(nowLimits, limits, names);
  const limitsTotal = Object.values(limits).reduce((s, v) => s + v, 0);
  useEffect(() => { setEdits({}); }, [rule, start]);

  const history = useMemo(() => [1, 2].map((n, i) => {
    const m = addMonth(month, -n), snap = closings.closingOf(m);
    return snap ? snap.categories : (past[i].data?.rows ?? []).filter((r) => r.group !== "metas").map((r) => ({ category_id: r.category_id, name: r.name, spent: r.spent, limit: r.budget }));
  }).filter((h) => h.length), [month, closings, past.map((p) => p.dataUpdatedAt).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const avgOf = (id: string) => { const v = history.map((h) => h.find((c) => c.category_id === id)?.spent ?? 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const ideas = useMemo(() => savingIdeas(history), [history]);
  const subsReview = useMemo(() => reviewSubscriptions(subs.data?.items ?? [], today), [subs.data, today]);
  const estimates = useMemo(() => (flow.data ? suggestEstimates({ history: pastTx.flatMap((q) => q.data ?? []), months: [1, 2, 3].map((n) => addMonth(month, -n)), expected: (flow.data.upcoming ?? []).map((u) => u.name) }) : []),
    [flow.data, month, pastTx.map((q) => q.dataUpdatedAt).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = cycle === "c" ? custom : cycleDates(month, cycle);
  const bad = !range.start || !range.end || range.end <= range.start;
  const existing = [nextCycle.data, current.data].find((c) => c && c.start_date.slice(0, 7) === range.start.slice(0, 7)) ?? null;
  const overlapping = specials.all.filter((s) => !bad && s.start <= range.end && s.end >= range.start);
  const chosenSpecials = (withSpecials ?? stored.specials ?? []).filter((id) => overlapping.some((s) => s.id === id));

  const create = useMutation({
    mutationFn: async () => {
      if (!plan || bad) throw new Error("Confira as datas do período.");
      if (rule === "proporcao" && !splitOk) throw new Error("Confira a proporção: precisa dar 100%.");
      if (rule === "proporcao") setSettings({ split });
      const allocations = spendCats.filter((c) => (limits[c.id] ?? 0) > 0).map((c) => ({ category_id: c.id, planned: limits[c.id], priority: (c.group === "necessidades" ? "essencial" : "flexivel") as "essencial" | "flexivel", rollover: existing?.allocations.find((a) => a.category_id === c.id)?.rollover ?? false }));
      const kept = (existing?.allocations ?? []).filter((a) => !spendCats.some((c) => c.id === a.category_id)).map(({ category_id, planned, priority, rollover }) => ({ category_id, planned, priority, rollover }));
      const payload: BudgetCyclePayload = { mode: rule === "503020" ? "503020" : "personalizado", period: "mensal", start_date: range.start, end_date: range.end, expected_income: plan.inTotal,
        allocations: [...allocations, ...kept], extraordinary: false, notes: rule === "proporcao" ? `Proporção ${splitLabel(split)}` : model ? `Modelo: ${model.name}` : existing?.notes ?? null };
      // The plan first: it is the Orçamento's own data and works offline; the cycle needs the server.
      const expected = Object.fromEntries([...plan.incomes, ...plan.bills].filter((r) => r.on && r.key.startsWith("tx:")).map((r) => [r.key, r.value]));
      await plans.save.mutateAsync({ ...stored, month, specials: chosenSpecials, approved: decisions.approved, ignored: decisions.ignored, saving, reminders, expected: { ...(stored.expected ?? {}), ...expected },
        planned_income: plan.inTotal, planned_bills: plan.billTotal, planned_saving: plan.saveTotal, planned_spend: Math.round((plan.inTotal - plan.billTotal - plan.saveTotal) * 100) / 100 });
      return existing ? updateBudgetCycle(existing.id, payload) : createBudgetCycle(payload);
    },
    onSuccess: async () => {
      setSuccess(true);
      await Promise.all([qc.invalidateQueries({ queryKey: ["budget-v2-current"] }), qc.invalidateQueries({ queryKey: ["budget-v2-next"] }), qc.invalidateQueries({ queryKey: ["budget-v2-history"] })]);
    },
    onError: (e) => toast.error(e instanceof Error && e.message.startsWith("Confira") ? e.message : `O plano do mês ficou salvo, mas o período não: ${getApiErrorMessage(e)}`),
  });

  const title = `Começar ${short}`;
  const sub = bad ? monthLabel(month) : `Período de ${fmt(range.start)} a ${fmt(range.end)}`;
  if (!plan || !cats.data) {
    const l = <FinnosPageLoading title="Montando o mês" description="Juntando entradas, contas, assinaturas e limites." />;
    return desktop ? <DeskPage testId="budget-new-page"><DeskHeader title={title} month={month} setMonth={setMonth} />{l}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={title} subtitle={sub} month={month} setMonth={setMonth} />{l}</div>;
  }

  const startBalance = nowView ? (month > currentMonth() ? nowView.endBalance : nowView.inAccounts) : 0;
  const outlook = monthOutlook({ startBalance, inTotal: plan.inTotal, billTotal: plan.billTotal, limitsTotal, saveTotal: plan.saveTotal });
  const noIncome = plan.inTotal <= 0;
  const decide = (row: PlanRow) => {
    const d = toggleDecision(row);
    const approved = decisions.approved.filter((k) => k !== row.key), ignored = decisions.ignored.filter((k) => k !== row.key);
    if (d === "approve") approved.push(row.key);
    if (d === "ignore") ignored.push(row.key);
    setReview({ approved, ignored });
  };
  const includeAllRepeated = () => {
    const keys = plan.bills.filter((b) => b.origin === "sugestao" && !b.on).map((b) => b.key);
    setReview({ approved: [...new Set([...decisions.approved, ...keys])], ignored: decisions.ignored.filter((k) => !keys.includes(k)) });
  };
  const forecast = (type: "receita" | "despesa", prefill?: { name: string; value: number; day: number; category_id?: string | null; account_id?: string | null }) =>
    dialogs.openTransaction({ type, date: `${month}-${String(prefill?.day ?? 15).padStart(2, "0")}`, prefill: { status: "pendente", ...(prefill ? { name: prefill.name, value: prefill.value, category_id: prefill.category_id ?? undefined, account_id: prefill.account_id ?? undefined } : {}) } });
  const setGoal = (id: string, v: number) => setSavingDraft({ ...saving, [id]: Math.max(0, v) });
  const addReminder = (r: PlanReminder) => setRem([...reminders.filter((x) => x.id !== r.id), r].sort((a, b) => a.date.localeCompare(b.date)));
  const removeReminder = (id: string) => setRem(reminders.filter((x) => x.id !== id));
  const repeatedOff = plan.bills.filter((b) => b.origin === "sugestao" && !b.on).length;
  const rowsAll = [...plan.incomes, ...plan.bills];
  const cancelMarked = subsReview.lines.filter((s) => reminders.some((r) => r.id === `cancelar:${s.id}`));
  const reminderIdeas = suggestReminders(rowsAll, [], reminders).slice(0, 8);
  const shares = rule === "503020" ? { necessidades: 50, desejos: 30, futuro: 20 } : split;

  const rowList = (rows: PlanRow[], empty: string) => (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card">
      {rows.map((r) => (
        <li key={r.key} className={cn("flex items-center gap-3 px-3.5 py-2.5", !r.on && "opacity-60")}>
          <span className="grid h-11 w-10 shrink-0 place-content-center rounded-xl bg-primary/[0.07] text-center"><strong className="font-heading text-[15px] leading-none">{r.date.slice(8)}</strong><span className="mt-0.5 text-[9px] font-bold tracking-wide">{MON[Number(r.date.slice(5, 7)) - 1]}</span></span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{r.name}</strong><span className="text-xs text-muted-foreground">{r.origin === "cartao" ? "Fatura · compras e parcelas que já vêm" : r.note}</span></span>
          <strong className={cn("text-sm tabular-nums", r.type === "receita" && "text-income")}>{r.type === "receita" ? "+ " : ""}{money(r.value)}</strong>
          <Switch on={r.on} onClick={() => decide(r)} label={`${r.on ? "Tirar" : "Incluir"} ${r.name}`} />
        </li>
      ))}
      {!rows.length ? <li className="px-4 py-5 text-center text-sm text-muted-foreground">{empty}</li> : null}
    </ul>
  );
  const estimateList = (type: "receita" | "despesa") => {
    const list = estimates.filter((e) => e.type === type);
    return list.length ? (
      <div className="mt-3">
        <p className="text-xs font-semibold text-muted-foreground">Costumam {type === "receita" ? "entrar" : "sair"} e ainda não estão previstos</p>
        <ul className="mt-1 divide-y divide-border text-sm">{list.map((e) => <li key={e.key} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1"><span className="block truncate font-medium">{e.name}</span><span className="text-xs text-muted-foreground">média de {e.months} meses · dia {e.day}</span></span><strong className="tabular-nums">{money(e.value)}</strong><Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => forecast(type, e)}>Prever</Button></li>)}</ul>
      </div>
    ) : null;
  };

  // ---------- sections, in the order things are decided ----------
  const ruleSection = (
    <Section id="regra" title="Regra do período" hint={`Como ${short} vai ser dividido. Vale só para este período.`}>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Regra do período">
        {([["503020", "50/30/20", "Necessidades, desejos e futuro"], ["personalizado", "Personalizado", "Você define cada limite"], ["proporcao", "Proporção", "Sua divisão, somando 100%"]] as const).map(([id, t, n]) => (
          <button key={id} type="button" role="radio" aria-checked={rule === id} onClick={() => setRule(id)} className={cn("rounded-2xl px-4 py-3 text-left", rule === id ? "border-2 border-primary bg-primary/[0.06]" : "border border-border bg-card hover:bg-muted/40")} data-testid={`rule-${id}`}>
            <strong className="block text-sm">{t}</strong><span className="text-xs text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>
      {rule === "proporcao" ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([["necessidades", "Necessidades"], ["desejos", "Desejos"], ["futuro", "Futuro (metas)"]] as const).map(([k, l]) => (
            <label key={k} className="grid gap-1 text-xs text-muted-foreground">{l}<span className="flex items-center gap-1"><Input inputMode="numeric" className="h-9" value={String(split[k])} onChange={(e) => setSplit({ ...split, [k]: Math.max(0, Math.min(100, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0))) })} />%</span></label>
          ))}
          <p className={cn("col-span-3 text-xs", splitOk ? "text-muted-foreground" : "text-expense")}>{splitOk ? "Soma 100%." : `A soma está em ${splitSum}%: precisa dar 100%.`}</p>
        </div>
      ) : null}
      {rule === "personalizado" ? (
        <label className="mt-3 grid gap-1.5 text-[13px] font-semibold">Começar a partir de
          <select value={start} onChange={(e) => setStart(e.target.value as typeof start)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm font-normal">
            <option value="anterior">Os limites de agora</option>
            {settings.models.map((m) => <option key={m.id} value={`modelo:${m.id}`}>Modelo · {m.name}</option>)}
            <option value="novo">Do zero</option>
          </select>
        </label>
      ) : null}
      <div className="mt-4"><Segmented label="Ciclo" value={cycle} options={CYCLES} onChange={setCycle} /></div>
      {cycle === "c" ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <label className="grid gap-1.5 text-[13px] font-semibold">Começa<Input type="date" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} /></label>
          <label className="grid gap-1.5 text-[13px] font-semibold">Termina<Input type="date" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} /></label>
        </div>
      ) : null}
      <p className={cn("mt-2 text-[13px]", bad ? "text-expense" : "text-muted-foreground")}>{bad ? "A data final precisa ser depois da inicial." : `De ${fmt(range.start)} a ${fmt(range.end)}.`}{existing ? ` ${Short} já tem um período: começar de novo substitui as datas e os limites dele.` : ""}</p>
    </Section>
  );
  const division = noIncome ? (
    <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="new-period-no-income"><AlertTriangle className="h-4 w-4 shrink-0" />Preveja o que vai entrar em {short} para o orçamento se dividir.</p>
  ) : rule === "personalizado" ? (
    <dl className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-muted/50 p-3 text-center text-xs" data-testid="new-period-division">
      <div><dt className="text-muted-foreground">Contas</dt><dd className="font-heading text-sm font-bold tabular-nums">{money(plan.billTotal)}</dd></div>
      <div><dt className="text-muted-foreground">Dia a dia</dt><dd className="font-heading text-sm font-bold tabular-nums">{money(limitsTotal)}</dd></div>
      <div><dt className="text-muted-foreground">Metas</dt><dd className="font-heading text-sm font-bold tabular-nums">{money(plan.saveTotal)}</dd></div>
    </dl>
  ) : (
    <dl className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-muted/50 p-3 text-center text-xs" data-testid="new-period-division">
      {([["Necessidades", shares.necessidades], ["Desejos", shares.desejos], ["Futuro", shares.futuro]] as const).map(([l, p]) => <div key={l}><dt className="text-muted-foreground">{l} · {p}%</dt><dd className="font-heading text-sm font-bold tabular-nums">{money(plan.inTotal * p / 100)}</dd></div>)}
    </dl>
  );
  const sections = [
    ruleSection,
    <Section key="entra" id="entra" title="O que vai entrar" hint="Confirme valor e dia. O que é só estimativa não entra no livre até cair." action={<span className="text-sm font-semibold tabular-nums text-income">{money(plan.inTotal)}</span>}>
      {rowList(plan.incomes, `Nada previsto para entrar em ${short} ainda.`)}
      <Button type="button" size="sm" className="mt-3 rounded-full" onClick={() => forecast("receita")}><Plus className="h-4 w-4" /> Prever receita</Button>
      {estimateList("receita")}
      {division}
    </Section>,
    <Section key="sai" id="sai" title="O que vai sair" hint="Contas fixas, faturas com as parcelas que vêm, assinaturas e o que passou do mês anterior. Repetidas começam fora: inclua o que vai acontecer." action={<span className="text-sm font-semibold tabular-nums">{money(plan.billTotal)}</span>}>
      {repeatedOff ? <Button type="button" size="sm" variant="outline" className="mb-3 rounded-full" onClick={includeAllRepeated} data-testid="include-all-repeated">Incluir todas as repetidas ({repeatedOff})</Button> : null}
      {rowList(plan.bills, `Nada previsto para sair em ${short} ainda.`)}
      <Button type="button" size="sm" className="mt-3 rounded-full" onClick={() => forecast("despesa")}><Plus className="h-4 w-4" /> Prever conta</Button>
      {estimateList("despesa")}
    </Section>,
    <Section key="guardar" id="guardar" title="Guardar ou cortar" hint={noIncome ? undefined : `Depois das contas sobram ${money(plan.inTotal - plan.billTotal)} para o dia a dia e as metas.`}>
      <p className="text-xs font-semibold text-muted-foreground">Metas · {money(plan.saveTotal)} no mês</p>
      {goalList.length ? (
        <ul className="divide-y divide-border">
          {goalList.map((g) => (
            <li key={g.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1"><strong className="block truncate">{g.name}</strong><span className="text-xs text-muted-foreground">{money(g.saved)} de {money(g.target)}{g.contribution ? ` · sugerido ${money(g.contribution)}/mês` : ""}</span></span>
              <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => setGoal(g.id, (saving[g.id] ?? 0) - 50)} aria-label={`Menos para ${g.name}`}>−</Button>
              <strong className="w-24 text-center tabular-nums">{money(saving[g.id] ?? 0)}</strong>
              <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => setGoal(g.id, (saving[g.id] ?? 0) + 50)} aria-label={`Mais para ${g.name}`}>+</Button>
            </li>
          ))}
        </ul>
      ) : <p className="py-1 text-sm text-muted-foreground">Nenhuma meta ainda. <Link to="/metas" className="font-semibold text-primary">Criar uma meta</Link></p>}
      {ideas.length ? (
        <>
          <p className="mt-4 text-xs font-semibold text-muted-foreground">Onde dá para economizar</p>
          <ul className="divide-y divide-border">
            {ideas.slice(0, 4).map((i) => { const applied = edits[i.category_id] === i.to; return (
              <li key={i.category_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-[13px]"><span className="min-w-0 flex-1">{i.text}</span><Button size="sm" variant={applied ? "default" : "outline"} className="h-8 rounded-full" onClick={() => setEdits((e) => (applied ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== i.category_id)) : { ...e, [i.category_id]: i.to }))}>{applied ? "Aplicado" : `Limite ${money(i.to)}`}</Button></li>
            ); })}
          </ul>
        </>
      ) : null}
      {subsReview.lines.length ? (
        <>
          <p className="mt-4 text-xs font-semibold text-muted-foreground">Assinaturas · {money(subsReview.monthly)} por mês</p>
          <ul className="divide-y divide-border">
            {subsReview.lines.map((sItem) => { const id = `cancelar:${sItem.id}`, marked = reminders.some((r) => r.id === id); return (
              <li key={sItem.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{sItem.name}</span><span className="text-xs text-muted-foreground">{money(sItem.value)} · cobra em {dm(sItem.next)} · {money(sItem.yearly)} por ano</span></span>
                <Button size="sm" variant={marked ? "default" : "outline"} className="h-8 rounded-full" onClick={() => (marked ? removeReminder(id) : addReminder({ id, date: sItem.cancelBy, text: `Cancelar ${sItem.name} antes da cobrança de ${dm(sItem.next)}`, kind: "assinatura" }))}><Bell className="h-3.5 w-3.5" /> {marked ? "Vou cancelar" : "Cancelar"}</Button>
              </li>
            ); })}
          </ul>
          {cancelMarked.length ? <p className="mt-1 text-[13px] text-income">Cancelando as marcadas: {money(cancelMarked.reduce((s, x) => s + x.yearly, 0))} a menos por ano.</p> : null}
        </>
      ) : null}
    </Section>,
    <Section key="limites" id="limites" title="Limites do dia a dia" hint={rule === "personalizado" ? "Ajuste com − e +. A média é dos últimos meses." : `Calculados pela regra ${rule === "503020" ? "50/30/20" : splitLabel(split)} sobre o que vai entrar. Ajuste com − e +.`} action={<span className="text-sm font-semibold tabular-nums">{money(limitsTotal)}</span>}>
      <ul className="divide-y divide-border" data-testid="new-period-limits">
        {spendCats.filter((c) => (limits[c.id] ?? 0) > 0 || avgOf(c.id) > 0).map((c) => {
          const v = limits[c.id] ?? 0, avg = avgOf(c.id), was = nowLimits[c.id] ?? 0;
          return (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="text-xs text-muted-foreground">média {money(avg)}{was && Math.abs(was - v) >= 1 ? ` · era ${money(was)}` : ""}</span></span>
              <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => setEdits((e) => ({ ...e, [c.id]: Math.max(0, v - 50) }))} aria-label={`Diminuir ${c.name}`}>−</Button>
              <strong className={cn("w-24 text-center tabular-nums", avg > v && v > 0 && "text-amber-700 dark:text-amber-400")}>{money(v)}</strong>
              <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => setEdits((e) => ({ ...e, [c.id]: v + 50 }))} aria-label={`Aumentar ${c.name}`}>+</Button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Em laranja: abaixo do que você costuma gastar.</p>
      {overlapping.length ? (
        <div className="mt-3 rounded-2xl border border-border p-3">
          <strong className="block text-sm">Plano especial</strong>
          <span className="block text-xs text-muted-foreground">Começa fora. Inclua se vai acontecer neste período.</span>
          {overlapping.map((s) => { const on = chosenSpecials.includes(s.id); return (
            <div key={s.id} className="mt-2 flex items-center gap-3"><span className="min-w-0 flex-1 text-[13px]"><strong className="block truncate">{s.name}</strong><span className="text-xs text-muted-foreground">{dm(s.start)} a {dm(s.end)} · {money(s.amount)}</span></span><Switch on={on} label={`${on ? "Tirar" : "Incluir"} ${s.name}`} onClick={() => setWithSpecials(on ? chosenSpecials.filter((x) => x !== s.id) : [...chosenSpecials, s.id])} /></div>
          ); })}
        </div>
      ) : null}
    </Section>,
    <Section key="lembretes" id="lembretes" title="Lembretes" hint="Aparecem no início do Orçamento no dia marcado.">
      {reminders.length ? (
        <ul className="divide-y divide-border" data-testid="new-period-reminders">
          {reminders.map((r) => <li key={r.id} className="flex items-center gap-3 py-2 text-sm"><Bell className="h-4 w-4 shrink-0 text-amber-600" /><span className="w-12 shrink-0 tabular-nums text-muted-foreground">{dm(r.date)}</span><span className="min-w-0 flex-1">{r.text}</span><Button size="icon-sm" variant="ghost" onClick={() => removeReminder(r.id)} aria-label={`Tirar lembrete ${r.text}`}><Trash2 className="h-4 w-4" /></Button></li>)}
        </ul>
      ) : null}
      <div className="mt-2 grid grid-cols-[8.5rem_1fr_auto] gap-2">
        <Input type="date" value={newRem.date} min={`${month}-01`} max={`${month}-31`} onChange={(e) => setNewRem((n) => ({ ...n, date: e.target.value }))} aria-label="Dia do lembrete" />
        <Input value={newRem.text} maxLength={140} placeholder="O que lembrar" onChange={(e) => setNewRem((n) => ({ ...n, text: e.target.value }))} aria-label="O que lembrar" />
        <Button type="button" className="rounded-full" disabled={!newRem.date || !newRem.text.trim()} onClick={() => { addReminder({ id: `livre:${Date.now().toString(36)}`, date: newRem.date, text: newRem.text.trim(), kind: "outro" }); setNewRem({ date: "", text: "" }); }}>Adicionar</Button>
      </div>
      {reminderIdeas.length ? (
        <ul className="mt-3 divide-y divide-border">
          {reminderIdeas.map((r) => <li key={r.id} className="flex items-center gap-3 py-2 text-sm text-muted-foreground"><span className="w-12 shrink-0 tabular-nums">{dm(r.date)}</span><span className="min-w-0 flex-1">{r.text}</span><Button size="sm" variant="ghost" className="h-8 rounded-full text-primary" onClick={() => addReminder(r)}><Plus className="h-3.5 w-3.5" /> Lembrar</Button></li>)}
        </ul>
      ) : null}
    </Section>,
  ];

  const reviewSection = (
    <div className={cn("grid items-start gap-4", desktop ? "grid-cols-2" : "grid-cols-1")} id="revisao">
      <Panel title={`Se ${short} seguir o orçamento`}>
        <dl className="grid gap-1.5 text-[13px]" data-testid="new-period-outlook">
          {([["Entra", outlook.inTotal, "in"], ["Contas e faturas", -outlook.billTotal, ""], ["Dia a dia (limites)", -outlook.limitsTotal, ""], ["Guardar em metas", -outlook.saveTotal, ""]] as const).map(([l, v, t]) => (
            <div key={l} className="flex justify-between"><dt className="text-muted-foreground">{l}</dt><dd className={cn("tabular-nums font-medium", t === "in" && "text-income")}>{v < 0 ? "− " : ""}{money(Math.abs(v))}</dd></div>
          ))}
          <div className="flex justify-between border-t border-border pt-2 text-sm"><dt className="font-semibold">Sobra no fim do mês</dt><dd className={cn("font-heading text-lg font-bold tabular-nums", outlook.leftover < 0 ? "text-expense" : "text-income")} data-testid="new-period-free">{noIncome ? "—" : money(outlook.leftover)}</dd></div>
        </dl>
        <p className={cn("mt-3 rounded-xl px-3 py-2.5 text-[13px]", noIncome || outlook.tone === "apertado" ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : outlook.tone === "negativo" ? "bg-expense/10 text-expense" : "bg-income/10 text-income")}>
          {noIncome ? `Falta prever o que vai entrar em ${short}.` : outlook.tone === "negativo" ? `Do jeito que está, ${short} fecha ${money(-outlook.leftover)} no vermelho. Tire uma conta, baixe um limite ou guarde menos.` : outlook.tone === "apertado" ? `Fecha, mas apertado: sobram só ${money(outlook.leftover)}.` : `Seguindo o orçamento, sobram ${money(outlook.leftover)} em ${short}${plan.saveTotal ? `, além dos ${money(plan.saveTotal)} nas metas` : ""}.`}
        </p>
        {nowView && !noIncome ? <p className="mt-2 text-xs text-muted-foreground">As contas começam {short} com cerca de {money(startBalance)} e terminam perto de {money(outlook.endBalance)}.</p> : null}
        <div className="mt-3 grid gap-1 text-[13px]">
          <p><strong>Regra:</strong> {rule === "503020" ? "50/30/20" : rule === "proporcao" ? `proporção ${splitLabel(split)}` : "personalizado"} · {fmt(range.start)} a {fmt(range.end)}</p>
          <p><strong>Limites:</strong> {changes.changed.length ? changes.changed.slice(0, 3).map((c) => `${c.name} ${c.from ? `${money(c.from)} → ` : "novo, "}${money(c.to)}`).join("; ") + (changes.changed.length > 3 ? "…" : "") : "os mesmos de agora."}</p>
          <p><strong>Lembretes:</strong> {reminders.length ? `${reminders.length} marcados.` : "nenhum."}</p>
        </div>
      </Panel>
      <Panel title={`${Short} no calendário`}>
        <MonthAgenda month={month} money={money} items={[
          ...rowsAll.filter((r) => r.on).map((r) => ({ date: r.date, name: r.name, value: r.value, kind: r.type === "receita" ? "entra" as const : "sai" as const })),
          ...reminders.map((r) => ({ date: r.date, name: r.text, kind: "lembrete" as const })),
        ]} />
      </Panel>
    </div>
  );
  const startButton = (
    <button type="button" disabled={bad || create.isPending || (rule === "proporcao" && !splitOk)} onClick={() => create.mutate()} className="flex h-14 w-full items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50" data-testid="new-period-create">
      {create.isPending ? "Salvando…" : `${existing ? "Atualizar" : "Começar"} ${short}`}
    </button>
  );
  const successEl = success ? (
    <BudgetSuccess title={`${Short} começou`} amountLabel={noIncome ? "No dia a dia" : "Sobra se seguir o orçamento"} amount={money(noIncome ? limitsTotal : outlook.leftover)}
      chips={[rule === "503020" ? "50/30/20" : rule === "proporcao" ? `Proporção ${splitLabel(split)}` : "Personalizado", `${money(limitsTotal)} nos limites`, ...(plan.saveTotal ? [`${money(plan.saveTotal)} para metas`] : []), ...(reminders.length ? [`${reminders.length} lembretes`] : [])]}
      action="Ir para o Orçamento" onDone={() => navigate(`/orcamento?mes=${month}`)} />
  ) : null;

  if (desktop) return (
    <DeskPage testId="budget-new-page">
      <DeskHeader title={title} subtitle={sub} month={month} setMonth={setMonth} />
      <div className="grid grid-cols-2 items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5">{sections[0]}{sections[1]}{sections[3]}</div>
        <div className="flex min-w-0 flex-col gap-5">{sections[2]}{sections[4]}{sections[5]}</div>
      </div>
      <h2 className="font-heading text-lg font-semibold">Revisão</h2>
      {reviewSection}
      <div className="mx-auto w-full max-w-md">{startButton}</div>
      {successEl}
    </DeskPage>
  );
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 pb-6" data-testid="budget-new-page">
      <BudgetHeader title={title} subtitle={sub} month={month} setMonth={setMonth} />
      {sections}
      <h2 className="pt-2 font-heading text-lg font-semibold">Revisão</h2>
      {reviewSection}
      {startButton}
      {successEl}
    </div>
  );
}
