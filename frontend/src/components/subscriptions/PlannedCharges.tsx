import { ChevronRight, Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import type { Category, PlannedCharge } from "@/types/finnos";

/** Registered subscriptions expected in the period Fluxo shows: plans, not transactions yet. */
export function PlannedCharges({ items, categories, hidden }: { items: PlannedCharge[]; categories: Category[]; hidden: boolean }) {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card" data-testid="planned-charges">
      <header className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
          Assinaturas previstas
          <span className="text-muted-foreground">· {items.length}</span>
        </h2>
        <span className="text-sm font-semibold tabular-nums text-expense">{money(total)}</span>
      </header>
      <ul className="divide-y divide-border/70 px-2 py-1">
        {items.map((item) => {
          const category = categories.find((c) => c.id === item.category_id);
          return (
            <li key={`${item.subscription_id}-${item.date}`}>
              <Link to="/assinaturas" className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted" data-testid="planned-charge-row">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category?.color ?? "#64748B" }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{formatDate(item.date)} · Prevista, ainda não lançada</span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-expense">{hidden ? formatHiddenBRL() : `-${formatBRL(item.value)}`}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
