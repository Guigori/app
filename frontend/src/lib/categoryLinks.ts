import { currentMonth } from "@/lib/format";

/** Where a category is explored: Fluxo filtered by it, which already links on to Análise. */
export function categoryFlowPath(categoryId: string, month: string = currentMonth(), metric: "despesas" | "receitas" = "despesas"): string {
  return `/transacoes?month=${month}&metric=${metric}&category_id=${encodeURIComponent(categoryId)}`;
}
