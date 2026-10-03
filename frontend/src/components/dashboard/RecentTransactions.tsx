import { Link } from "react-router-dom";
import { ArrowRight, PlusCircle } from "lucide-react";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBalanceHidden } from "@/lib/balance";
import { formatDate, formatHiddenBRL, formatSignedBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types/finnos";

function signedValue(t: Transaction): number {
  return t.type === "receita" ? t.value : -t.value;
}

export function RecentTransactions({
  transactions,
  categoryName = null,
  month,
  categoryId = null,
}: {
  transactions: Transaction[];
  categoryName?: string | null;
  month?: string;
  categoryId?: string | null;
}) {
  const dialogs = useDialogs();
  const { hidden } = useBalanceHidden();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="font-heading">{categoryName ? `Últimas transações · ${categoryName}` : "Transações recentes"}</CardTitle>
          <CardDescription>{categoryName ? `Movimentações de ${categoryName} no mês selecionado` : "As últimas movimentações do mês"}</CardDescription>
        </div>
        {transactions.length > 0 ? (
          <Link
            to={categoryId && month ? `/transacoes?month=${month}&category_id=${categoryId}` : "/transacoes"}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            data-testid="see-all-transactions-link"
          >
            Ver todas
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <EmptyState
            icon={<PlusCircle className="h-5 w-5" aria-hidden="true" />}
            title="Nenhuma transação ainda"
            description="Adicione sua primeira movimentação para começar a acompanhar suas finanças."
            action={
              <Button onClick={() => dialogs.openTransaction()} data-testid="empty-add-transaction-button">
                Adicionar transação
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3" data-testid="recent-transaction-item">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: (t.category_color ?? "#64748B") + "1A", color: t.category_color ?? "#64748B" }}
                  aria-hidden="true"
                >
                  <CategoryIcon name={t.category_icon ?? "more-horizontal"} className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[t.category_name ?? (t.type === "transferencia" ? "Transferência" : "Sem categoria"), t.account_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                    )}
                    data-testid="recent-transaction-value"
                  >
                    {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
