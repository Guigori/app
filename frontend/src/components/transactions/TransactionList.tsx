/**
 * The Fluxo list of lançamentos (table from tablets up, cards grouped by day on phones). Shared by Fluxo and the
 * Orçamento so a record looks and opens the same everywhere: tapping opens its detail, the pencil edits, the bin
 * deletes after confirming.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTransaction } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { settledCents } from "@/lib/settledMoney";
import { useBalanceHidden } from "@/lib/balance";
import { formatDate, formatHiddenBRL, formatSignedBRL, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { captureBadge } from "@/lib/pendingCaptures";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Transaction } from "@/types/finnos";

function signedValue(t: Transaction): number {
  return t.type === "receita" ? t.value : -t.value;
}

function formatBRLShort(t: Transaction): string {
  const value = t.installment_value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** "Apple Pay", "Apple Pay · automático" (and "valor alto"): so these lançamentos are easy to spot. */
function CaptureMark({ t }: { t: Transaction }) {
  return (
    <Badge variant="secondary" className={cn("px-1.5 py-0 text-xs", t.capture_unusual && "bg-amber-500/15 text-amber-800 dark:text-amber-300")} data-testid="transaction-capture">
      {captureBadge(t)}
    </Badge>
  );
}

export function TransactionList({ transactions, highlightedTransactionId = null }: { transactions: Transaction[]; highlightedTransactionId?: string | null }) {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);

  const groupedTransactions = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    transactions.forEach((transaction) => {
      const group = groups.get(transaction.date) ?? [];
      group.push(transaction);
      groups.set(transaction.date, group);
    });
    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items,
      net: items.reduce((sum, item) => sum + (item.type === "receita" ? settledCents(item) : -settledCents(item)), 0) / 100,
    }));
  }, [transactions]);

  // Tapping a lançamento explains it; the edit and delete buttons inside keep their own action.
  const detailProps = (t: Transaction) => ({
    tabIndex: 0,
    "aria-label": `Ver detalhes de ${t.name}`,
    onClick: (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("button, a")) return;
      dialogs.openTransactionDetail(t, transactions);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); dialogs.openTransactionDetail(t, transactions); }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: async () => {
      toast.success("Transação excluída.");
      setPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
        queryClient.invalidateQueries({ queryKey: ["trends"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <>
      <div className="hidden rounded-2xl border border-border bg-card md:block" data-testid="transactions-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Transação</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => (
              <TableRow key={t.id} id={`transaction-${t.id}`} {...detailProps(t)} data-testid="transaction-row" className={cn("cursor-pointer", highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                <TableCell>
                  <p className="font-medium text-foreground">{t.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.fixed ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-xs">Fixa · {t.recurrence}</Badge>
                    ) : null}
                    {t.status !== "pago" && t.notify_enabled === false ? (
                      <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs">
                        <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                      </Badge>
                    ) : null}
                    {t.installment && t.total_installments ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                        {t.current_installment}/{t.total_installments} · {t.total_installments}x de {formatBRLShort(t)}
                      </Badge>
                    ) : null}
                    {captureBadge(t) ? <CaptureMark t={t} /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  {t.category_name ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.category_color ?? "#64748B" }} aria-hidden="true" />
                      {t.category_name}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {t.account_name}
                  {t.to_account_name ? <span className="text-muted-foreground"> → {t.to_account_name}</span> : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                  )}
                  data-testid="transaction-value"
                >
                  {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => dialogs.openTransaction({ transaction: t })}
                      aria-label={`Editar ${t.name}`}
                      data-testid={`edit-transaction-${t.id}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete(t)}
                      aria-label={`Excluir ${t.name}`}
                      data-testid={`delete-transaction-${t.id}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-5 md:hidden" data-testid="transactions-card-list">
        {groupedTransactions.map((group) => (
          <section key={group.date} className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="transaction-day-group">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <p className="font-heading text-sm font-bold text-foreground">
                  {group.date === todayISO() ? "Hoje · " : ""}{formatDate(group.date)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.items.length} {group.items.length === 1 ? "lançamento" : "lançamentos"}
                </p>
              </div>
              <p className={cn(
                "shrink-0 font-heading text-sm font-bold tabular-nums",
                group.net > 0 ? "text-income" : group.net < 0 ? "text-expense" : "text-foreground",
              )}>
                {hidden ? formatHiddenBRL() : formatSignedBRL(group.net)}
              </p>
            </div>

            <div className="divide-y divide-border">
              {group.items.map((t) => (
                <div key={t.id} id={`transaction-${t.id}`} {...detailProps(t)} className={cn("cursor-pointer px-4 py-3.5 transition-colors hover:bg-muted/40", highlightedTransactionId === t.id && "bg-primary/5 ring-2 ring-inset ring-primary/30")} data-testid="transaction-card">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: (t.category_color ?? "#64748B") + "1A",
                        color: t.category_color ?? "#64748B",
                      }}
                      aria-hidden="true"
                    >
                      <CategoryIcon name={t.category_icon ?? "more-horizontal"} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{t.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[t.category_name ?? (t.type === "transferencia" ? "Transferência" : "Sem categoria"), t.account_name]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <p className={cn(
                          "shrink-0 font-heading text-base font-bold tabular-nums",
                          t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                        )}>
                          {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                        </p>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap gap-1">
                          <StatusBadge status={t.status} />
                          {t.fixed ? <Badge variant="secondary" className="px-1.5 py-0 text-xs">Fixa</Badge> : null}
                          {t.status !== "pago" && t.notify_enabled === false ? (
                            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs">
                              <BellOff className="h-3 w-3" aria-hidden="true" /> Sem aviso
                            </Badge>
                          ) : null}
                          {t.installment && t.total_installments ? (
                            <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                              {t.current_installment}/{t.total_installments}
                            </Badge>
                          ) : null}
                          {captureBadge(t) ? <CaptureMark t={t} /> : null}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button size="icon-sm" variant="ghost" onClick={() => dialogs.openTransaction({ transaction: t })} aria-label={`Editar ${t.name}`} data-testid={`edit-transaction-${t.id}`}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPendingDelete(t)} aria-label={`Excluir ${t.name}`} data-testid={`delete-transaction-${t.id}`}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir transação?"
        description={pendingDelete ? `"${pendingDelete.name}" será removida permanentemente.` : ""}
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </>
  );
}
