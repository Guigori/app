/**
 * Três análises da biblioteca (as primeiras que têm o que dizer) no início do Orçamento, escolhidas pelo momento do mês: no mês em curso, o que pede uma
 * decisão agora; num mês fechado, o que ensinou; num mês à frente, o que já está comprometido. Cada uma abre a análise
 * completa, no mesmo mês.
 */
import { Link } from "react-router-dom";
import type { MonthView } from "@/lib/budget/monthView";
import { CatalogInsight } from "@/components/insights/CatalogInsight";
import { detailPath } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";

const PICKS: Record<MonthView["when"], { ids: string[]; hint: string }> = {
  // Antes de passar: categorias acima do que costumam a esta altura, o efeito formiga e o que as parcelas novas já prendem.
  current: { ids: ["acima-do-normal", "gastos-pequenos", "parcelas-novas", "recorrentes-escondidos", "fim-de-semana", "maiores-gastos"], hint: "O que pede uma decisão antes do mês acabar." },
  past: { ids: ["categorias-subiram", "onde-economizou", "taxa-poupanca", "maiores-gastos", "fixo-x-variavel"], hint: "O que este mês ensinou." },
  future: { ids: ["compromissos", "parcelas-terminam", "fixo-x-variavel", "proximos-30-dias"], hint: "O que já está comprometido daqui para frente." },
};

export function MonthAnalyses({ v, columns = 1, className }: { v: MonthView; columns?: 1 | 3; className?: string }) {
  const pick = PICKS[v.when];
  return (
    <section aria-label="Análises do mês" className={cn("min-w-0", className)} data-testid="budget-analyses">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <div><h2 className="font-heading text-[17px] font-bold">Análises do mês</h2><p className="text-xs text-muted-foreground">{pick.hint}</p></div>
        <Link to="/analise" className="shrink-0 text-xs font-semibold text-primary">Ver todas</Link>
      </div>
      <div className={cn("grid gap-3 [&>*:nth-child(n+4)]:hidden", columns === 3 ? "grid-cols-3" : "grid-cols-1")}>
        {pick.ids.map((id) => <CatalogInsight key={id} id={id} size="M" month={v.month} to={detailPath(id, { month: v.month })} className="min-h-[170px]" hideEmpty />)}
      </div>
    </section>
  );
}
