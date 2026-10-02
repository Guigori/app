import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, PlusCircle, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTransaction, fetchAccounts, fetchCategories, fetchTransactions } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { useBalanceHidden } from "@/lib/balance";
import {
  currentMonth,
  formatDate,
  formatHiddenBRL,
  formatSignedBRL,
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Account, Category, Transaction, TxStatus, TxType } from "@/types/finnos";

function signedValue(t: Transaction): number {
  return t.type === "receita" ? t.value : -t.value;
}

export default function Transactions() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();

  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"todos" | TxType>("todos");
  const [status, setStatus] = useState<"todos" | TxStatus>("todos");
  const [categoryId, setCategoryId] = useState("todas");
  const [accountId, setAccountId] = useState("todas");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);

  const deferredSearch = useDeferredValue(search);

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const filters = useMemo(() => {
    const f: Record<string, string> = { month };
    if (deferredSearch.trim()) f.search = deferredSearch.trim();
    if (type !== "todos") f.type = type;
    if (status !== "todos") f.status = status;
    if (categoryId !== "todas") f.category_id = categoryId;
    if (accountId !== "todas") f.account_id = accountId;
    return f;
  }, [month, deferredSearch, type, status, categoryId, accountId]);

  const transactionsQuery = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => fetchTransactions(filters),
  });
  const transactions = transactionsQuery.data ?? [];

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
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const hasFilters = type !== "todos" || status !== "todos" || categoryId !== "todas" || accountId !== "todas" || deferredSearch.trim() !== "";

  const clearFilters = () => {
    setSearch("");
    setType("todos");
    setStatus("todos");
    setCategoryId("todas");
    setAccountId("todas");
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Transações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Registre, busque e filtre todas as suas movimentações.</p>
        </div>
        <Button onClick={() => dialogs.openTransaction()} data-testid="new-transaction-button">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Nova transação
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome…"
              className="pl-9"
              aria-label="Buscar transações"
              data-testid="transaction-search-input"
            />
          </div>
          <MonthSelector month={month} onChange={setMonth} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as TxType | "todos")}>
            <SelectTrigger size="sm" className="w-40" aria-label="Filtrar por tipo" data-testid="filter-type-select">
              <SelectValue>{type === "todos" ? "Todos os tipos" : TX_TYPE_LABEL[type]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
              <SelectItem value="despesa">Despesa</SelectItem>
              <SelectItem value="transferencia">Transferência</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as TxStatus | "todos")}>
            <SelectTrigger size="sm" className="w-36" aria-label="Filtrar por status" data-testid="filter-status-select">
              <SelectValue>{status === "todos" ? "Todos os status" : TX_STATUS_LABEL[status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="agendado">Agendado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger size="sm" className="w-44" aria-label="Filtrar por categoria" data-testid="filter-category-select">
              <SelectValue>{categoryId === "todas" ? "Todas as categorias" : categories.find((c) => c.id === categoryId)?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger size="sm" className="w-40" aria-label="Filtrar por conta" data-testid="filter-account-select">
              <SelectValue>{accountId === "todas" ? "Todas as contas" : accounts.find((a) => a.id === accountId)?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters-button">
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>

      {transactionsQuery.isPending ? (
        <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-hidden="true" />
      ) : transactionsQuery.error ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground" data-testid="transactions-error-message">
              Não foi possível carregar as transações. Tente novamente.
            </p>
            <Button variant="outline" onClick={() => transactionsQuery.refetch()} data-testid="transactions-retry-button">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<PlusCircle className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma transação encontrada no período"
          description="Ajuste os filtros ou registre uma nova movimentação para começar."
          action={
            <Button onClick={() => dialogs.openTransaction()} data-testid="transactions-empty-add-button">
              Adicionar transação
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="transactions-count">
            {transactions.length} {transactions.length === 1 ? "transação" : "transações"}
          </p>

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
                  <TableRow key={t.id} data-testid="transaction-row">
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{t.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.fixed ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Fixa · {t.recurrence}</Badge>
                        ) : null}
                        {t.installment && t.total_installments ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {t.current_installment}/{t.total_installments} · {t.total_installments}x de {formatBRLShort(t)}
                          </Badge>
                        ) : null}
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

          <div className="space-y-3 md:hidden" data-testid="transactions-card-list">
            {transactions.map((t) => (
              <Card key={t.id} className="py-0" data-testid="transaction-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{t.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[t.category_name ?? (t.type === "transferencia" ? "Transferência" : "Sem categoria"), t.account_name]
                          .filter(Boolean)
                          .join(" · ")}
                        {" · "}
                        {formatDate(t.date)}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "shrink-0 font-heading text-base font-bold tabular-nums",
                        t.type === "receita" ? "text-income" : t.type === "despesa" ? "text-expense" : "text-transfer",
                      )}
                    >
                      {hidden ? formatHiddenBRL() : formatSignedBRL(signedValue(t))}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={t.status} />
                      {t.fixed ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Fixa</Badge> : null}
                      {t.installment && t.total_installments ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {t.current_installment}/{t.total_installments}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" onClick={() => dialogs.openTransaction({ transaction: t })} aria-label={`Editar ${t.name}`} data-testid={`edit-transaction-${t.id}`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPendingDelete(t)} aria-label={`Excluir ${t.name}`} data-testid={`delete-transaction-${t.id}`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

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
    </div>
  );
}

function formatBRLShort(t: Transaction): string {
  const value = t.installment_value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
