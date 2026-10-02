import { useQuery } from "@tanstack/react-query";
import { Pencil, Trash2, Wallet } from "lucide-react";
import { fetchAccount } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";

interface AccountDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | null;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
}

interface AccountDetail {
  account: Account;
  transactions: {
    id: string;
    name: string;
    date: string;
    value: number;
    type: "receita" | "despesa" | "transferencia";
  }[];
}

export function AccountDetailDialog({ open, onOpenChange, account, onEdit, onDelete }: AccountDetailDialogProps) {
  const { hidden } = useBalanceHidden();
  const detailQuery = useQuery({
    queryKey: ["account", account?.id],
    queryFn: () => fetchAccount(account?.id ?? ""),
    enabled: open && !!account,
  });

  if (!account) return null;
  const detail = detailQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 font-heading">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: account.color + "1A", color: account.color }}
              aria-hidden="true"
            >
              <Wallet className="h-5 w-5" />
            </span>
            {account.name}
          </DialogTitle>
          <DialogDescription>{account.institution || "Conta financeira"}</DialogDescription>
        </DialogHeader>

        {detailQuery.isPending ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
            <div className="h-24 w-full animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Saldo atual</p>
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums text-foreground" data-testid="account-detail-balance">
                {hidden ? formatHiddenBRL() : formatBRL(detail.account.balance)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3" data-testid="account-detail-flows">
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <p className="text-xs text-muted-foreground">Entradas</p>
                <p className="font-heading text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {hidden ? formatHiddenBRL() : formatBRL(detail.account.total_income)}
                </p>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3">
                <p className="text-xs text-muted-foreground">Saídas</p>
                <p className="font-heading text-base font-bold tabular-nums text-rose-700 dark:text-rose-400">
                  {hidden ? formatHiddenBRL() : formatBRL(detail.account.total_expense)}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Últimas transações</p>
              {detail.transactions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma movimentação nesta conta ainda.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="account-detail-transaction">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
                      </div>
                      <p
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          t.type === "receita" ? "text-income" : "text-expense",
                        )}
                      >
                        {hidden ? formatHiddenBRL() : formatBRL(t.type === "receita" ? t.value : -t.value)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Não foi possível carregar a conta" description="Feche e abra novamente em instantes." />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onEdit(account)} data-testid="account-detail-edit-button">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(account)} data-testid="account-detail-delete-button">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
