/**
 * Orçamento · tela 10 (Planos especiais): viagem, Natal, mudança, uma compra grande.
 * O plano guarda só as datas, o valor, os limites por categoria e a meta ligada. O dinheiro fica numa meta, em Metas
 * (ou é o 13º), e os gastos vêm do Fluxo. Acaba sozinho no fim: o orçamento de sempre não muda.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Target } from "lucide-react";
import { toast } from "sonner";
import { fetchCategories, fetchMe, fetchTransactions } from "@/lib/data";
import { saveGoal } from "@/lib/goals";
import { currentMonth, monthLabel } from "@/lib/format";
import { newSpecialId, SPECIAL_KINDS, type BudgetSpecial, type SpecialKind } from "@/lib/budget/server";
import { monthlyFor, monthsUntil, specialMonths, spentIn, specialStatus, validateSpecial, type SpecialPhase } from "@/lib/budget/specials";
import { BudgetHeader, card, h2, useMoney, useMonthData, todayISO } from "@/components/budget/shared";
import { DeskHeader, DeskPage, KpiStrip, Panel, useIsDesktop } from "@/components/budget/desktop/kit";
import { useBudgetPlans, useBudgetSpecials } from "@/components/budget/usePlans";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TITLE = "Planos especiais";
const PHASE_TONE: Record<SpecialPhase, string> = {
  Guardando: "bg-primary/10 text-primary",
  Pronto: "bg-income/10 text-income",
  "Em andamento": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  Terminou: "bg-muted text-muted-foreground",
};
const fmtD = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
const parseMoney = (v: string) => { const n = Number(v.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const GOAL_CATEGORY: Partial<Record<SpecialKind, string>> = { Viagem: "Viagem", "Férias": "Viagem", Compra: "Casa", "Mudança": "Casa" };

interface Row { sp: BudgetSpecial; saved: number; spent: number }

function PlanCard({ row, today, money, open, onToggle, onEnd, isIn, setIn }: { row: Row; today: string; money: (v: number) => string; open: boolean; onToggle: () => void; onEnd: () => void; isIn: (month: string) => boolean; setIn: (month: string, on: boolean) => void }) {
  const { sp } = row;
  const s = specialStatus(sp, today, row.saved, row.spent, money);
  const [confirm, setConfirm] = useState(false);
  const using = s.phase === "Em andamento" || s.phase === "Terminou";
  return (
    <article className="overflow-hidden rounded-[20px] border border-border bg-card" data-testid="special-plan">
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full p-4 text-left hover:bg-muted/30">
        <span className="flex items-center justify-between gap-3"><strong className="truncate font-heading text-base">{sp.name}</strong><span className="flex items-center gap-2"><span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold", PHASE_TONE[s.phase])}>{s.phase}</span><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} /></span></span>
        <span className="mt-1 block text-xs text-muted-foreground">{fmtD(sp.start)} a {fmtD(sp.end)} · {sp.kind} · {money(sp.amount)}</span>
        <span className="mt-3 flex justify-between text-xs"><span className="text-muted-foreground">{s.barLabel}</span><strong className="tabular-nums">{using ? `${money(s.spent)} de ${money(sp.amount)}` : sp.source === "13" ? "em dezembro" : `${money(s.saved)} de ${money(sp.amount)}`}</strong></span>
        <span aria-hidden="true" className="mt-1.5 block h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", using ? (row.spent > sp.amount ? "bg-expense" : "bg-amber-500") : "bg-primary")} style={{ width: `${Math.round(s.percent * 100)}%` }} /></span>
        <span className={cn("mt-1.5 block text-xs", s.phase === "Pronto" ? "text-income" : "text-muted-foreground")}>{s.hint}</span>
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4 text-[13px]">
          {sp.source !== "13" ? (
            <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Target className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate">{sp.goal_name ? `Meta “${sp.goal_name}”` : "Meta ainda não criada"}</strong><span className="text-muted-foreground">{sp.goal_id ? `${money(row.saved)} de ${money(sp.amount)}${sp.monthly && !using ? ` · ${money(sp.monthly)} por mês` : ""}` : "Crie a meta em Metas para guardar o dinheiro."}</span></span>
              <Link to="/metas" className="text-xs font-bold text-primary">em Metas</Link>
            </div>
          ) : null}
          <div>
            <strong className="text-sm">Limites durante o plano</strong>
            {sp.categories.length ? sp.categories.map((c) => <div key={c.category_id} className="flex justify-between border-t border-border/60 py-1.5 first:mt-1"><span>{c.name}</span><span className="tabular-nums">{money(c.limit)}</span></div>)
              : <p className="mt-1 text-muted-foreground">Sem categorias: o plano não muda nenhum limite.</p>}
          </div>
          <div>
            <strong className="text-sm">No orçamento</strong>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">{s.impact}</p>
            {s.phase !== "Terminou" ? (
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Incluir no orçamento do mês">
                {specialMonths(sp).filter((m) => m >= today.slice(0, 7)).map((m) => { const on = isIn(m); const label = monthLabel(m).split(" ")[0].toLowerCase(); return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => setIn(m, !on)} className={cn("h-8 rounded-full px-3 text-xs font-bold", on ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")} data-testid="special-include">{on ? `Incluído em ${label}` : `Incluir em ${label}`}</button>
                ); })}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/orcamento/gastos?mes=${(sp.start <= today && sp.end >= today ? today : sp.start).slice(0, 7)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}>Ver no mês</Link>
            {!confirm ? <Button type="button" variant="outline" size="sm" className="rounded-full text-expense" onClick={() => setConfirm(true)}>Encerrar plano</Button> : null}
          </div>
          {confirm ? (
            <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-2xl bg-expense/10 px-3 py-2.5 font-semibold text-expense">
              <span className="flex-1">{sp.goal_id ? "Encerrar? O que está guardado continua na meta." : "Encerrar este plano?"}</span>
              <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setConfirm(false)}>Manter</Button>
              <Button type="button" size="sm" className="rounded-full bg-expense text-white hover:bg-expense/90" onClick={onEnd}>Encerrar</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CreateForm({ today, money, goals, categories, accounts, onCreated, compact }: {
  today: string; money: (v: number) => string; compact: boolean;
  goals: { id: string; name: string; saved: number }[];
  categories: { id: string; name: string }[];
  accounts: { id: string; type: string; active: boolean }[];
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const specials = useBudgetSpecials();
  const [kind, setKind] = useState<SpecialKind>("Viagem");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [amt, setAmt] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [source, setSource] = useState<BudgetSpecial["source"]>("nova");
  const [goalId, setGoalId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const amount = parseMoney(amt);
  const goal = goals.find((g) => g.id === goalId);
  const n = start ? monthsUntil(today, start) : 1;
  const monthly = amount > 0 && start ? monthlyFor(today, start, amount) : 0;
  const inDec = start.slice(5, 7) === "12";
  const valid = amount > 0 && start && end && end >= start;
  let preview = "Preencha o valor e as datas.", warn = false;
  if (valid) {
    if (source === "nova") preview = `Cria a meta “${name.trim() || "Plano"}” em Metas: guardar ${money(monthly)} por mês até ${fmtD(start)}. Para o dinheiro sair do livre, aprove o aporte ao planejar cada mês.`;
    else if (source === "existente") { warn = !!goal && goal.saved < amount; preview = !goal ? "Escolha qual meta paga o plano." : warn ? `A meta ${goal.name} tem ${money(goal.saved)}. Faltam ${money(amount - goal.saved)}: escolha outra forma ou um valor menor.` : `Usa ${money(amount)} da meta ${goal.name}. Ficam ${money(goal.saved - amount)} guardados.`; }
    else { warn = !inDec; preview = warn ? "O 13º cai em dezembro. Para um plano em outra data, guarde numa meta." : `Usa ${money(amount)} do 13º de dezembro.`; }
  }
  const chip = (on: boolean) => cn("h-9 rounded-full px-3 text-xs font-bold", on ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card");

  const create = async () => {
    const e = validateSpecial({ name, start, end, amount, source, goalSaved: source === "existente" ? goal?.saved : 0 });
    if (e) return setErr(e);
    if (warn) return setErr("Ajuste como juntar o dinheiro antes de criar.");
    setBusy(true); setErr("");
    const chosen = categories.filter((c) => cats.includes(c.id));
    const each = chosen.length ? Math.round((amount / chosen.length) * 100) / 100 : 0;
    let goal_id: string | null = source === "existente" ? goalId : null;
    let goal_name: string | null = source === "existente" ? goal?.name ?? null : source === "nova" ? name.trim() : null;
    let goalFailed = false;
    if (source === "nova" && me.data?.id) {
      try {
        goal_id = await saveGoal(me.data.id, { id: crypto.randomUUID(), name: name.trim(), category: GOAL_CATEGORY[kind] ?? "Outros", mode: "tradicional", target: amount, saved: 0, months: n, contribution: monthly,
          frequency: "Mensal", account: accounts.find((a) => a.active && a.type !== "beneficio")?.id ?? "", strategy: null, remind: true, radar: false, createdAt: new Date().toISOString() });
        void qc.invalidateQueries({ queryKey: ["goals"] });
      } catch { goalFailed = true; goal_id = null; goal_name = null; }
    }
    const sp: BudgetSpecial = { id: newSpecialId(), name: name.trim(), kind, start, end, amount, source, goal_id, goal_name, monthly: source === "nova" ? monthly : 0,
      categories: chosen.map((c) => ({ category_id: c.id, name: c.name, limit: each })), created_at: new Date().toISOString() };
    specials.save.mutate(sp, {
      onSuccess: () => {
        setDone(goalFailed ? "Plano criado. A meta não foi criada agora (sem conexão?): crie em Metas e ela aparece aqui." : source === "nova" ? `Plano criado. A meta “${sp.name}” já está em Metas com ${money(monthly)} por mês.` : `Plano criado e ligado ${source === "13" ? "ao 13º salário" : `à meta ${goal?.name}`}.`);
        if (goalFailed) toast.message("A meta não foi criada agora. Crie em Metas.");
        setName(""); setAmt(""); setCats([]); onCreated(sp.id);
      },
      onSettled: () => setBusy(false),
    });
  };

  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-1.5", compact ? "grid-cols-4" : "grid-cols-4")} role="radiogroup" aria-label="Tipo de plano">
        {SPECIAL_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); if (!name.trim()) setName(""); }} className={cn(chip(kind === k), "px-1")}>{k}</button>)}
      </div>
      <label className="grid gap-1.5 text-[13px] font-semibold">Nome<Input value={name} onChange={(e) => { setName(e.target.value); setErr(""); setDone(""); }} placeholder={kind === "Natal" ? "Natal e fim de ano" : `Ex.: ${kind} de julho`} /></label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="grid gap-1.5 text-[13px] font-semibold">Começa<Input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); setErr(""); }} /></label>
        <label className="grid gap-1.5 text-[13px] font-semibold">Termina<Input type="date" value={end} min={start || today} onChange={(e) => { setEnd(e.target.value); setErr(""); }} /></label>
      </div>
      <label className="grid gap-1.5 text-[13px] font-semibold">Quanto vai custar (R$)<Input value={amt} inputMode="decimal" placeholder="0,00" onChange={(e) => { setAmt(e.target.value); setErr(""); }} /></label>
      <span className="text-[13px] font-semibold">Com o que vai gastar</span>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => { const on = cats.includes(c.id); return <button key={c.id} type="button" aria-pressed={on} onClick={() => setCats((x) => (on ? x.filter((y) => y !== c.id) : [...x, c.id]))} className={chip(on)}>{c.name}</button>; })}
      </div>
      <span className="text-[13px] font-semibold">Como juntar o dinheiro</span>
      <div className="grid gap-2" role="radiogroup" aria-label="Como juntar o dinheiro">
        {([
          ["nova", "Guardar até lá numa meta nova", amount > 0 && start ? `${money(monthly)} por mês durante ${n} ${n === 1 ? "mês" : "meses"}, em Metas` : "Uma meta com o valor e a data do plano"],
          ["existente", "Usar uma meta que já tenho", goals.length ? "O dinheiro já guardado paga o plano" : "Você ainda não tem metas"],
          ["13", "Usar o 13º salário", inDec ? "Cai em dezembro, dentro do plano" : "Só para planos em dezembro"],
        ] as const).map(([id, title, note]) => (
          <button key={id} type="button" role="radio" aria-checked={source === id} disabled={id === "existente" && !goals.length} onClick={() => { setSource(id); setErr(""); }}
            className={cn("rounded-2xl px-3.5 py-3 text-left disabled:opacity-50", source === id ? "border-2 border-primary bg-primary/[0.06]" : "border border-border bg-card")}>
            <strong className="block text-sm">{title}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>
          </button>
        ))}
      </div>
      {source === "existente" ? (
        <label className="grid gap-1.5 text-[13px] font-semibold">Qual meta
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">Escolha…</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.name} · {money(g.saved)} guardados</option>)}
          </select>
        </label>
      ) : null}
      <p className={cn("rounded-xl px-3 py-2.5 text-[13px] leading-relaxed", warn ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-primary/[0.06]")}>{preview}</p>
      {err ? <p role="alert" className="text-[13px] font-semibold text-expense">{err}</p> : null}
      <Button type="button" onClick={create} disabled={busy} className="h-11 rounded-full" data-testid="special-create">{source === "nova" ? "Criar plano e meta" : "Criar plano"}</Button>
      {done ? <p className="rounded-xl bg-income/10 px-3 py-2.5 text-[13px] font-semibold text-income">{done}</p> : null}
    </div>
  );
}

export default function BudgetSpecials() {
  const today = todayISO();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const { view, goals, accounts } = useMonthData(currentMonth());
  const specials = useBudgetSpecials();
  const plans = useBudgetPlans();
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [open, setOpen] = useState<string | null>(null);

  const started = specials.all.filter((sp) => sp.start <= today);
  const spentQ = useQueries({ queries: started.map((sp) => ({ queryKey: ["transactions", { start_date: sp.start, end_date: sp.end }], queryFn: () => fetchTransactions({ start_date: sp.start, end_date: sp.end }) })) });
  const savedOf = (id?: string | null) => (id ? view?.goals.find((g) => g.id === id)?.saved ?? goals.find((g) => g.id === id)?.saved ?? 0 : 0);
  const rows: Row[] = useMemo(() => specials.all.map((sp) => {
    const i = started.findIndex((x) => x.id === sp.id);
    return { sp, saved: savedOf(sp.goal_id), spent: i >= 0 && spentQ[i]?.data ? spentIn(sp, spentQ[i].data!) : 0 };
  }), [specials.all, view, goals, spentQ.map((q) => q.dataUpdatedAt).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const goalOptions = (view?.goals ?? goals.map((g) => ({ id: g.id, name: g.name, saved: g.saved })));
  const catOptions = (categories.data ?? []).filter((c) => c.group !== "metas" && c.name !== "Renda").map((c) => ({ id: c.id, name: c.name }));
  const savedAll = rows.filter((r) => r.sp.source !== "13").reduce((s, r) => s + r.saved, 0);
  const monthlyAll = rows.filter((r) => r.sp.end >= today && r.sp.start > today).reduce((s, r) => s + r.sp.monthly, 0);
  const running = rows.filter((r) => r.sp.start <= today && r.sp.end >= today).length;
  const intro = "O plano especial guarda só as datas e os limites por categoria. O dinheiro fica numa meta, em Metas, e os gastos vêm do Fluxo. Nada entra sozinho: você inclui o plano nos meses em que ele acontece, aqui ou ao criar o período.";
  const end = (id: string) => specials.end.mutate(id, { onSuccess: () => toast.success("Plano encerrado. A meta continua em Metas.") });

  const list = rows.length ? (
    <div className="grid gap-2.5">{rows.map((r) => <PlanCard key={r.sp.id} row={r} today={today} money={money} open={open === r.sp.id} onToggle={() => setOpen((o) => (o === r.sp.id ? null : r.sp.id))} onEnd={() => end(r.sp.id)} isIn={(m) => (plans.planOf(m).specials ?? []).includes(r.sp.id)} setIn={(m, on) => plans.includeSpecial(m, r.sp.id, on)} />)}</div>
  ) : (
    <div className="rounded-[20px] border border-dashed border-border p-6 text-center">
      <strong className="font-heading">Nenhum plano especial</strong>
      <p className="mt-1 text-sm text-muted-foreground">Para uma viagem, o Natal ou uma compra grande: crie um plano com as datas e quanto vai custar.</p>
    </div>
  );
  const form = <CreateForm today={today} money={money} goals={goalOptions} categories={catOptions} accounts={accounts} onCreated={(id) => setOpen(id)} compact={!desktop} />;

  if (desktop) return (
    <DeskPage testId="budget-specials-page">
      <DeskHeader title={TITLE} subtitle="Viagem, Natal, mudança, uma compra grande" />
      <KpiStrip items={[
        { label: "Planos", value: String(rows.length), hint: running ? `${running} em andamento` : "nenhum em andamento" },
        { label: "Guardado em metas", value: money(savedAll), hint: "nas metas dos planos" },
        { label: "Por mês", value: money(monthlyAll), hint: "aportes até os planos começarem" },
        { label: "Em andamento", value: String(running), hint: "contam só se incluídos no mês" },
      ]} />
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-7 space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
          {list}
          <Link to={`/orcamento/projecao?mes=${currentMonth()}`} className="inline-block text-[13px] font-bold text-primary">Ver o efeito na projeção</Link>
        </div>
        <Panel title="Criar um plano especial" className="col-span-5 self-start">{form}</Panel>
      </div>
    </DeskPage>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4" data-testid="budget-specials-page">
      <BudgetHeader title={TITLE} subtitle="Viagem, Natal, mudança, uma compra grande" month={currentMonth()} monthSwitch={false} />
      <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">Planos</span><strong className="font-heading text-base">{rows.length}</strong></div>
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">Guardado em metas</span><strong className="font-heading text-base tabular-nums">{money(savedAll)}</strong></div>
        <div className="rounded-2xl border border-border bg-card p-3"><span className="block text-[11px] text-muted-foreground">Por mês</span><strong className="font-heading text-base tabular-nums">{money(monthlyAll)}</strong></div>
      </div>
      {list}
      <section className={card}><h2 className={cn(h2, "mb-3")}>Criar um plano especial</h2>{form}</section>
      <Link to={`/orcamento/projecao?mes=${currentMonth()}`} className="block text-center text-[13px] font-bold text-primary">Ver o efeito na projeção</Link>
    </div>
  );
}
