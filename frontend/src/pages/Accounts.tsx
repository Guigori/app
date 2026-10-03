import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, fetchAccounts } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, ACCOUNT_TYPE_LABEL } from "@/lib/format";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { AccountDetailDialog } from "@/components/accounts/AccountDetailDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Account } from "@/types/finnos";

export default function Accounts() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const accounts = accountsQuery.data ?? [];

  const [selected, setSelected] = useState<Account | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: async () => {
      toast.success("Conta excluída.");
      setPendingDelete(null);
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Contas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Onde seu dinheiro vive: saldos, entradas e saídas.</p>
        </div>
        <Button onClick={() => dialogs.openAccount()} data-testid="new-account-button">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Nova conta
        </Button>
      </div>

      {accountsQuery.isPending ? (
        <FinnosPageLoading title="Carregando contas" description="Buscando seus saldos, entradas e saídas." />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma conta ainda"
          description="Cadastre sua primeira conta bancária ou carteira para acompanhar o saldo com precisão."
          action={
            <Button onClick={() => dialogs.openAccount()} data-testid="accounts-empty-create-button">
              Criar conta
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="accounts-grid">
          {accounts.map((account) => (
            <Card
              key={account.id}
              className="cursor-pointer py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => setSelected(account)}
              data-testid={`account-card-${account.id}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: account.color + "1A", color: account.color }}
                      aria-hidden="true"
                    >
                      <Wallet className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-heading font-semibold text-foreground">{account.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {account.institution || ACCOUNT_TYPE_LABEL[account.type]}
                      </p>
                    </div>
                  </div>
                  {!account.active ? <Badge variant="outline">Inativa</Badge> : null}
                </div>
                <p
                  className="mt-4 font-heading text-2xl font-bold tabular-nums text-foreground"
                  data-testid={`account-balance-${account.id}`}
                >
                  {hidden ? formatHiddenBRL() : formatBRL(account.balance)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`account-flows-${account.id}`}>
                  <span className="text-emerald-600 dark:text-emerald-400">Entradas {formatBRL(account.total_income)}</span>
                  <span className="text-rose-600 dark:text-rose-400">Saídas {formatBRL(account.total_expense)}</span>
                </div>
                <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      dialogs.openAccount(account);
                    }}
                    data-testid={`edit-account-${account.id}`}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(account);
                    }}
                    data-testid={`delete-account-${account.id}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AccountDetailDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        account={selected}
        onEdit={(account) => {
          setSelected(null);
          dialogs.openAccount(account);
        }}
        onDelete={(account) => setPendingDelete(account)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir conta?"
        description={
          pendingDelete
            ? `A conta "${pendingDelete.name}" será removida. Contas com transações vinculadas não podem ser excluídas.`
            : ""
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
