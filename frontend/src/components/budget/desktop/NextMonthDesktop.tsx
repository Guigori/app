import type { ReactNode } from "react";
/** Orçamento · planejar o próximo mês no computador: uma tabela do que entra e sai, e ao lado o resto e os limites. */
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Check, Plus } from "lucide-react";
import type { NextMonthPlan, PlanRow, PlanTone } from "@/lib/budget/nextMonth";
import type { FinnosGoal } from "@/lib/goals";
import { BulletBar, SegmentedBar } from "@/components/charts/FinnosCharts";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { DeskHeader, DeskPage, KpiStrip, Panel, td, th } from "@/components/budget/desktop/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/finnos";

const TONE: Record<PlanTone, [string, string]> = {
  "nao-fecha": ["Não fecha", "bg-expense/10 text-expense"],
  atencao: ["Atenção", "bg-amber-500/15 text-amber-800 dark:text-amber-200"],
  pode: ["Pode gastar", "bg-income/10 text-income"],
};
const GOAL_COLORS = ["var(--finnos-purple)", "var(--finnos-violet)", "#B3A6FF", "#070F52"];

export interface NextDesktopProps {
  month: string; setMonth: (m: string) => void; short: string; money: (n: number) => string; plan: NextMonthPlan | null;
  goals: FinnosGoal[]; save: Record<string, number>; setGoal: (id: string, v: number) => void; preset: (k: "gastar" | "equilibrado" | "guardar") => void;
  limitRows: Category[]; lim: Record<string, number>; avg: Record<string, number>; setLimit: (id: string, v: number) => void; limitsTotal: number; limitsChanged: boolean;
  decide: (r: PlanRow) => void; forecast: (t: "receita" | "despesa") => void; savePlan: () => void; saving: boolean;
  specials?: ReactNode;
}

export function NextMonthDesktop(p: NextDesktopProps) {
  const { plan, money, short } = p;
  return (
    <DeskPage testId="budget-next">
      <DeskHeader title={`Planejar ${short}`} month={p.month} setMonth={p.setMonth} />
      {!plan ? <FinnosPageLoading title="Carregando o plano" description="Juntando o que está previsto no Fluxo." /> : (
        <>
          <KpiStrip
            items={[
              { label: `Para gastar em ${short}`, value: money(plan.spend), tone: plan.tone === "nao-fecha" ? "expense" : plan.tone === "pode" ? "income" : undefined, hint: plan.tone === "nao-fecha" ? `Faltam ${money(-plan.spend)}` : plan.habit ? `Seu gasto médio: ${money(plan.habit)}` : undefined, testId: "next-spend" },
              { label: "Vai entrar", value: `+ ${money(plan.inTotal)}`, tone: "income", hint: `${plan.incomes.filter((r) => r.on).length} de ${plan.incomes.length} incluídas` },
              { label: "Compromissos", value: `− ${money(plan.billTotal)}`, hint: `${plan.bills.filter((r) => r.on).length} de ${plan.bills.length} incluídos` },
              { label: "Metas", value: `− ${money(plan.saveTotal)}`, hint: "Metas confirma o aporte" },
              { label: "Limites do dia a dia", value: money(p.limitsTotal), tone: p.limitsTotal > plan.spend ? "expense" : undefined, hint: p.limitsTotal > plan.spend ? `${money(p.limitsTotal - plan.spend)} acima do que sobra` : "cabem no que sobra" },
            ]}
            aside={<div className="flex flex-col items-end gap-1.5"><span className={cn("rounded-full px-3 py-1 text-xs font-semibold", TONE[plan.tone][1])}>{TONE[plan.tone][0]}</span><Button onClick={p.savePlan} disabled={p.saving} className="rounded-full px-4" data-testid="next-save">{p.saving ? "Salvando…" : "Salvar plano"}</Button></div>}
          />

          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-7 flex min-w-0 flex-col gap-5">
            <Panel flush title="O que entra e o que sai" action={<span className="pr-5 text-xs text-muted-foreground">Marque o que vai acontecer em {short}</span>} >
              <table className="w-full">
                <thead className="border-y border-border bg-muted/40"><tr><th className={cn(th, "w-12 pl-5")}>Incluir</th><th className={cn(th, "w-16")}>Dia</th><th className={th}>Nome</th><th className={th}>De onde vem</th><th className={cn(th, "pr-5 text-right")}>Valor</th></tr></thead>
                <tbody>
                  {([["receita", "Entradas", plan.incomes, plan.inTotal, "Prever uma entrada"], ["despesa", "Compromissos", plan.bills, plan.billTotal, "Prever uma conta"]] as const).map(([type, label, rows, total, add]) => (
                    <Fragment key={type}>
                      <tr className="border-b border-border bg-muted/20"><td colSpan={4} className="py-2 pl-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td><td className={cn("py-2 pr-5 text-right text-sm font-semibold tabular-nums", type === "receita" && "text-income")}>{money(total)}</td></tr>
                      {rows.map((r) => (
                        <tr key={r.key} className={cn("border-b border-border", !r.on && "text-muted-foreground")} data-testid="plan-row" data-on={r.on}>
                          <td className={cn(td, "pl-5")}><button type="button" onClick={() => p.decide(r)} aria-pressed={r.on} aria-label={`${r.on ? "Tirar" : "Incluir"} ${r.name}`} className={cn("grid h-5 w-5 place-items-center rounded-md", r.on ? "bg-primary text-primary-foreground" : "border-2 border-border")}>{r.on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}</button></td>
                          <td className={cn(td, "tabular-nums")}>{r.date.slice(8)}/{r.date.slice(5, 7)}</td>
                          <td className={cn(td, "font-medium", !r.on && "font-normal")}>{r.name}</td>
                          <td className={cn(td, "text-xs text-muted-foreground")}>{r.on || r.origin === "sugestao" ? r.note : "Fora deste mês · continua no Fluxo"}</td>
                          <td className={cn(td, "pr-5 text-right tabular-nums", r.on && type === "receita" && "text-income")}>{type === "receita" ? "+ " : ""}{money(r.value)}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-border"><td colSpan={5} className="py-1.5 pl-4"><Button variant="ghost" size="sm" onClick={() => p.forecast(type)} className="text-primary"><Plus className="h-3.5 w-3.5" /> {add}</Button></td></tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-xs text-muted-foreground">Repetidas e assinaturas começam desmarcadas: só entram se você incluir. O que você prevê é salvo no Fluxo como estimativa.</p>
            </Panel>
              <Panel title="O que fazer com o resto" action={<span className="text-sm font-semibold tabular-nums">{money(plan.rest)}</span>} testId="next-rest">
                {p.goals.length ? (
                  <>
                    <div className="mb-3 flex gap-1.5">{([["gastar", "Gastar mais"], ["equilibrado", "Equilibrado"], ["guardar", "Guardar mais"]] as const).map(([k, l]) => <Button key={k} variant="outline" size="sm" className="rounded-full" onClick={() => p.preset(k)}>{l}</Button>)}</div>
                    <SegmentedBar height={12} format={money} segments={[{ value: Math.max(0, plan.spend), color: "var(--income)", label: "Gastar" }, ...p.goals.filter((g) => (p.save[g.id] ?? 0) > 0).map((g, i) => ({ value: p.save[g.id], color: GOAL_COLORS[i % GOAL_COLORS.length], label: g.name }))]} />
                    <table className="mt-2 w-full text-[13px]"><tbody className="divide-y divide-border">
                      <tr><td className="py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded bg-income align-middle" />Gastar</td><td /><td className="py-2 text-right font-medium tabular-nums">{money(plan.spend)}</td><td /></tr>
                      {p.goals.map((g, i) => (
                        <tr key={g.id}>
                          <td className="py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded align-middle" style={{ backgroundColor: GOAL_COLORS[i % GOAL_COLORS.length] }} />{g.name}<span className="block pl-[18px] text-xs text-muted-foreground">Faltam {money(Math.max(0, g.target - g.saved))}</span></td>
                          <td className="w-8 py-2 text-right"><Button variant="outline" size="icon-xs" className="rounded-full" onClick={() => p.setGoal(g.id, (p.save[g.id] ?? 0) - 50)} aria-label={`Menos para ${g.name}`}>−</Button></td>
                          <td className="w-24 py-2 text-right font-medium tabular-nums">{money(p.save[g.id] ?? 0)}</td>
                          <td className="w-8 py-2 text-right"><Button variant="outline" size="icon-xs" className="rounded-full" onClick={() => p.setGoal(g.id, (p.save[g.id] ?? 0) + 50)} aria-label={`Mais para ${g.name}`}>+</Button></td>
                        </tr>
                      ))}
                    </tbody></table>
                  </>
                ) : <p className="text-[13px] text-muted-foreground">Você ainda não tem metas. Guardar dinheiro é sempre numa meta. <Link to="/metas" className="font-medium text-primary">Criar uma meta</Link></p>}
              </Panel>
            </div>

            <div className="col-span-5 flex min-w-0 flex-col gap-5">
              {p.specials ? <Panel title="Planos especiais neste mês">{p.specials}</Panel> : null}

              <Panel flush title="Limites do dia a dia" action={<span className="pr-5 text-xs text-muted-foreground">barra = média de 3 meses</span>} testId="next-limits">
                <table className="w-full">
                  <thead className="border-y border-border bg-muted/40"><tr><th className={cn(th, "pl-5")}>Categoria</th><th className={cn(th, "text-right")}>Média</th><th className={cn(th, "w-[26%]")} aria-label="Média contra limite" /><th className={cn(th, "pr-5 text-right")}>Limite</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {p.limitRows.map((c) => (
                      <tr key={c.id}>
                        <td className={cn(td, "whitespace-nowrap py-2 pl-5")}>{c.name}</td>
                        <td className={cn(td, "whitespace-nowrap py-2 text-right text-xs tabular-nums text-muted-foreground")}>{money(Math.round(p.avg[c.id] ?? 0))}</td>
                        <td className={cn(td, "py-2")}><BulletBar value={p.avg[c.id] ?? 0} limit={p.lim[c.id] ?? 0} format={money} /></td>
                        <td className={cn(td, "py-2 pr-5")}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="icon-xs" className="rounded-full" onClick={() => p.setLimit(c.id, Math.max(0, (p.lim[c.id] ?? 0) - 50))} aria-label={`Diminuir limite de ${c.name}`}>−</Button>
                            <span className="w-[5.5rem] whitespace-nowrap text-right text-[13px] font-medium tabular-nums">{money(p.lim[c.id] ?? 0)}</span>
                            <Button variant="outline" size="icon-xs" className="rounded-full" onClick={() => p.setLimit(c.id, (p.lim[c.id] ?? 0) + 50)} aria-label={`Aumentar limite de ${c.name}`}>+</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-5 py-3 text-xs text-muted-foreground">{p.limitsChanged ? "Os novos limites são salvos com o plano." : "Nada muda até salvar o plano."} Nada é lançado na Carteira.</p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </DeskPage>
  );
}
