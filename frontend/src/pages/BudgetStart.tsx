/**
 * Orçamento · tela 13 (primeira vez). Mostra o que o FINNOS encontrou nos últimos 3 meses (renda, contas fixas,
 * assinaturas e metas, cada um no seu módulo) e sugere limites pela média. A pessoa liga ou desliga cada um e só
 * então cria o orçamento: o Orçamento guarda só os limites aceitos.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createBudgetCycle, fetchBudget, fetchCategories, fetchCurrentBudgetCycle, fetchFlow, fetchMe, fetchSubscriptions, fetchTrends, updateBudgetCycle, type BudgetCyclePayload } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { buildStart, suggestionNote } from "@/lib/budget/firstTime";
import { cycleDates } from "@/lib/budget/newPeriod";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { BudgetHeader, h2, useMoney } from "@/components/budget/shared";
import { DeskHeader, DeskPage, Panel, useIsDesktop } from "@/components/budget/desktop/kit";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function BudgetStart() {
  const month = currentMonth();
  const { money } = useMoney();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const trends = useQuery({ queryKey: ["trends", 3, addMonth(month, -1)], queryFn: () => fetchTrends(3, addMonth(month, -1)) });
  const flow = useQuery({ queryKey: ["flow", "orcamento", month], queryFn: () => fetchFlow({ month, months: 1 }) });
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: Boolean(me.data?.id) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const current = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle, retry: false });
  const past = useQueries({ queries: [1, 2, 3].map((n) => { const m = addMonth(month, -n); return { queryKey: ["budget", m], queryFn: () => fetchBudget(m) }; }) });
  const [off, setOff] = useState<string[]>([]);

  const ready = trends.data && flow.data && past.every((q) => !q.isPending);
  const start = useMemo(() => (ready ? buildStart({
    past: past.flatMap((q) => (q.data ? [q.data] : [])).filter((b) => b.rows.some((r) => r.spent > 0)),
    trends: trends.data!.months, upcoming: flow.data!.upcoming ?? [], subscriptions: subs.data?.monthly_total ?? 0,
    goalsMonthly: (goals.data ?? []).reduce((s, g) => s + (g.contribution || 0), 0),
  }) : null), [ready, past.map((q) => q.dataUpdatedAt).join(), trends.data, flow.data, subs.data, goals.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = (start?.suggestions ?? []).filter((s) => !off.includes(s.category_id));
  const total = chosen.reduce((s, x) => s + x.value, 0);
  const rest = start ? start.income - start.goals - total : 0;

  const create = useMutation({
    mutationFn: async () => {
      const groups = new Map((cats.data ?? []).map((c) => [c.id, c.group]));
      const { start: s, end: e } = cycleDates(month, "1");
      const payload: BudgetCyclePayload = { mode: "personalizado", period: "mensal", start_date: s, end_date: e, expected_income: start?.income ?? 0, extraordinary: false, notes: "Criado pela média dos últimos meses",
        allocations: chosen.map((x) => ({ category_id: x.category_id, planned: x.value, priority: groups.get(x.category_id) === "necessidades" ? "essencial" as const : "flexivel" as const, rollover: false })) };
      const own = current.data && current.data.start_date.slice(0, 7) === month ? current.data : null;
      return own ? updateBudgetCycle(own.id, payload) : createBudgetCycle(payload);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["budget-v2-current"] }), qc.invalidateQueries({ queryKey: ["budget-v2-next"] })]);
      toast.success(`Orçamento de ${monthLabel(month).split(" ")[0].toLowerCase()} criado com ${chosen.length} limites.`);
      navigate(`/orcamento?mes=${month}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const title = "Montar meu orçamento";
  const sub = "Um ponto de partida com o que já está no Fluxo";
  if (!start) {
    const l = <FinnosPageLoading title="Olhando os últimos meses" description="Buscando renda e contas no Fluxo, assinaturas e metas." />;
    return desktop ? <DeskPage testId="budget-start-page"><DeskHeader title={title} subtitle={sub} />{l}</DeskPage> : <div className="mx-auto w-full max-w-[1240px] space-y-4"><BudgetHeader title={title} subtitle={sub} month={month} monthSwitch={false} />{l}</div>;
  }

  const found = (
    <div>
      <h2 className={h2}>Encontramos nos últimos {start.months || 3} meses</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Tudo isso continua no lugar de origem. O Orçamento só vai guardar os limites que você aceitar.</p>
      <dl className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border text-[13px]">
        {[
          ["Renda", start.income ? "Média do que entrou · Fluxo" : "Nada entrou nos últimos meses · Fluxo", money(start.income)],
          ["Contas fixas", start.fixed.names.length ? `${start.fixed.names.slice(0, 4).join(", ")}${start.fixed.names.length > 4 ? "…" : ""} · Fluxo` : "Nenhuma conta fixa · Fluxo", money(start.fixed.total)],
          ["Assinaturas", "Por mês · Assinaturas", money(start.subscriptions)],
          ["Metas", `${(goals.data ?? []).length} ${(goals.data ?? []).length === 1 ? "meta" : "metas"} · Metas`, `${money(start.goals)}/mês`],
        ].map(([k, n, v]) => <div key={k} className="flex justify-between gap-3 px-3.5 py-2.5"><span><dt className="text-sm font-semibold">{k}</dt><dd className="text-muted-foreground">{n}</dd></span><strong className="tabular-nums">{v}</strong></div>)}
      </dl>
    </div>
  );
  const list = (
    <div>
      <h2 className={h2}>Limites sugeridos pela média</h2>
      {start.suggestions.length ? (
        <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
          {start.suggestions.map((s) => {
            const on = !off.includes(s.category_id);
            return (
              <li key={s.category_id} className={cn("flex items-center gap-3 px-3.5 py-2.5", !on && "opacity-60")}>
                <span className="min-w-0 flex-1"><strong className="block text-sm">{s.name}</strong><span className="text-xs text-muted-foreground">{suggestionNote(s, money)}</span></span>
                <strong className="text-sm tabular-nums">{money(s.value)}</strong>
                <button type="button" role="switch" aria-checked={on} aria-label={`Usar limite de ${s.name}`} onClick={() => setOff((x) => (on ? [...x, s.category_id] : x.filter((y) => y !== s.category_id)))} className={cn("relative h-7 w-12 shrink-0 rounded-full", on ? "bg-primary" : "bg-muted")}>
                  <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">Ainda não há gastos suficientes para sugerir limites. Você pode definir cada um em Configurar.</p>}
      <p className="mt-3 text-[13px] text-muted-foreground" data-testid="start-note">{chosen.length ? `${money(total)} por mês nos limites. ${rest >= 0 ? `Sobram ${money(rest)} sem destino` : `Faltam ${money(-rest)}`}, depois das metas.` : "Sem limites: o Orçamento só mostra o que entra e sai."}</p>
    </div>
  );
  const actions = (
    <div className="space-y-2">
      <Button type="button" onClick={() => create.mutate()} disabled={create.isPending || !chosen.length} className="h-12 w-full rounded-full text-[15px]" data-testid="start-create">{create.isPending ? "Criando…" : `Criar orçamento com ${chosen.length} ${chosen.length === 1 ? "limite" : "limites"}`}</Button>
      <Link to="/orcamento/configuracoes" className={cn(buttonVariants({ variant: "ghost" }), "w-full rounded-full text-primary")}>Ajustar tudo antes</Link>
    </div>
  );

  if (desktop) return (
    <DeskPage testId="budget-start-page">
      <DeskHeader title={title} subtitle={sub} />
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-7">{list}</Panel>
        <div className="col-span-5 space-y-5 self-start"><Panel>{found}</Panel>{actions}</div>
      </div>
    </DeskPage>
  );
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-5" data-testid="budget-start-page">
      <BudgetHeader title={title} subtitle={sub} month={month} monthSwitch={false} />
      {found}
      {list}
      {actions}
    </div>
  );
}
