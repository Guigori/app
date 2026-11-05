import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchTransactions } from "@/lib/data";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { allocationBreakdown } from "@/lib/transactionInsight";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { cn } from "@/lib/utils";
import type { BudgetAllocationProgress, Transaction } from "@/types/finnos";

/** A category of the cycle; opening it lists the lançamentos that used its limit. */
export function AllocationRow({ allocation: a, start, end }: { allocation: BudgetAllocationProgress; start: string; end: string }) {
  const [open, setOpen] = useState(false);
  const { hidden } = useBalanceHidden();
  const dialogs = useDialogs();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const rows = useQuery({
    queryKey: ["transactions", "allocation", a.category_id, start, end],
    queryFn: () => fetchTransactions({ category_id: a.category_id, start_date: start, end_date: end, type: "despesa" }),
    enabled: open,
  });
  const split = rows.data ? allocationBreakdown(rows.data, a) : null;
  const over = a.available < 0;

  const list = (title: string, items: Transaction[]) => items.length ? (
    <div>
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border/70">
        {items.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => dialogs.openTransactionDetail(t)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-muted/50" data-testid="allocation-transaction">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.name}</span>
                <span className="block text-xs text-muted-foreground">{formatDate(t.date)} · {t.card_name ?? t.account_name}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{money(t.value)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <li className="py-4" data-testid="budget-allocation">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 text-left" data-testid="budget-allocation-toggle">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: (a.color ?? "#64748B") + "1A", color: a.color ?? "#64748B" }}>
          <CategoryIcon name={a.icon ?? "more-horizontal"} className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">{a.name ?? "Categoria"}</span>
            <span className="text-sm tabular-nums">{money(a.spent)} <span className="text-muted-foreground">+ {money(a.committed)} comprometido</span></span>
          </span>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", over ? "bg-expense" : a.percent >= 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(a.percent, 100)}%` }} />
          </span>
          <span className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>{Math.round(a.percent)}% previsto</span>
            <span className={over ? "font-semibold text-expense" : undefined}>{over ? `${money(-a.available)} acima do limite` : `${money(a.available)} disponível`}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div className="mt-3 space-y-3 rounded-2xl bg-muted/40 p-3" data-testid="budget-allocation-detail">
          {rows.isPending ? <div className="h-16 animate-pulse rounded-xl bg-muted" /> : rows.isError || !split ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar os lançamentos.</p>
          ) : (
            <>
              {!split.paid.length && !split.committed.length && !split.other ? <p className="px-1 text-sm text-muted-foreground">Nenhum lançamento nesta categoria no ciclo.</p> : null}
              {list("Já saiu", split.paid)}
              {list("Ainda vai sair", split.committed)}
              {split.other ? (
                <p className="px-1 text-xs text-muted-foreground" data-testid="budget-allocation-other">
                  Mais {money(split.other)} de parcelas de compras anteriores, despesas fixas e assinaturas previstas.
                </p>
              ) : null}
              <Link to={`/transacoes?aba=caixa&month=${start.slice(0, 7)}&metric=despesas&category_id=${encodeURIComponent(a.category_id)}`} className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-primary">
                <ChartNoAxesCombined className="h-4 w-4" aria-hidden="true" />Ver no Caixa
              </Link>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
