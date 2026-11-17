/** Planos especiais que caem no mês: começam fora e só contam se a pessoa incluir (Planejar e Criar período). */
import { Link } from "react-router-dom";
import { Plane } from "lucide-react";
import type { BudgetSpecial } from "@/lib/budget/server";
import { cn } from "@/lib/utils";

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function SpecialsInMonth({ month, specials, included, onToggle, money, className }: {
  month: string; specials: BudgetSpecial[]; included: string[]; onToggle: (id: string, on: boolean) => void; money: (v: number) => string; className?: string;
}) {
  const inMonth = specials.filter((s) => s.start.slice(0, 7) <= month && s.end.slice(0, 7) >= month);
  if (!inMonth.length) return null;
  return (
    <div className={cn("space-y-2", className)} data-testid="specials-in-month">
      <p className="text-xs text-muted-foreground">Começam fora. Inclua se o plano vai acontecer neste mês: o limite das categorias dele ganha o valor do plano.</p>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
        {inMonth.map((s) => { const on = included.includes(s.id); return (
          <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <Plane className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-[13px]"><strong className="block truncate">{s.name}</strong><span className="text-xs text-muted-foreground">{fmt(s.start)} a {fmt(s.end)} · {money(s.amount)} · {s.categories.map((c) => c.name).join(", ") || "sem categorias"}</span></span>
            <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "Tirar" : "Incluir"} ${s.name}`} onClick={() => onToggle(s.id, !on)} className={cn("relative h-7 w-12 shrink-0 rounded-full", on ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
            </button>
          </li>
        ); })}
      </ul>
      <Link to="/orcamento/especiais" className="text-xs font-semibold text-primary">Ver planos especiais</Link>
    </div>
  );
}
