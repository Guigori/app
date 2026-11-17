/**
 * Uma categoria ao longo dos meses: o gasto de cada um dos últimos 6 meses contra o limite daquele mês (o do
 * fechamento, quando o mês foi fechado). Ajuda a decidir o limite do próximo mês. Só leitura.
 */
import { useQueries } from "@tanstack/react-query";
import { fetchBudget } from "@/lib/data";
import { addMonth } from "@/lib/format";
import { BulletBar } from "@/components/charts/FinnosCharts";
import { useBudgetClosings } from "@/components/budget/usePlans";
import { roundLimit } from "@/lib/budget/firstTime";

const NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function CategoryHistory({ categoryId, name, month, money }: { categoryId: string; name: string; month: string; money: (v: number) => string }) {
  const months = [5, 4, 3, 2, 1, 0].map((n) => addMonth(month, -n));
  const qs = useQueries({ queries: months.map((m) => ({ queryKey: ["budget", m], queryFn: () => fetchBudget(m) })) });
  const closings = useBudgetClosings();
  if (qs.some((q) => q.isPending)) return <p className="py-2 text-xs text-muted-foreground">Lendo os últimos meses…</p>;
  const rows = months.map((m, i) => {
    const row = qs[i].data?.rows.find((r) => r.category_id === categoryId);
    const snap = closings.closingOf(m)?.categories.find((c) => c.category_id === categoryId);
    return { m, spent: snap?.spent ?? row?.spent ?? 0, limit: snap?.limit ?? row?.budget ?? 0 };
  });
  const past = rows.slice(0, -1).filter((r) => r.spent > 0);
  const avg = past.length ? past.reduce((s, r) => s + r.spent, 0) / past.length : 0;
  const overCount = past.filter((r) => r.limit > 0 && r.spent > r.limit).length;
  return (
    <div className="mt-2 rounded-xl bg-muted/40 p-3" data-testid="category-history">
      <p className="mb-2 text-xs font-semibold">{name} nos últimos 6 meses</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.m} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 text-xs">
            <span className={r.m === month ? "font-semibold" : "text-muted-foreground"}>{NAMES[Number(r.m.slice(5)) - 1]}</span>
            {r.limit > 0 ? <BulletBar value={r.spent} limit={r.limit} format={money} /> : <span className="h-2 rounded-full bg-primary/60" style={{ width: `${Math.min(100, (r.spent / Math.max(1, ...rows.map((x) => x.spent))) * 100)}%` }} />}
            <span className="tabular-nums text-muted-foreground">{money(r.spent)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {past.length ? `Média de ${money(avg)} nos meses anteriores${overCount ? `; passou do limite em ${overCount} de ${past.length}` : ""}. Um limite de ${money(roundLimit(avg))} acompanha o que você costuma gastar.` : "Ainda sem meses anteriores para comparar."}
      </p>
    </div>
  );
}
