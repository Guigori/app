import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createTransaction, fetchAccounts, fetchCards, fetchCategories, updateTransaction } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, parseAmount, todayISO, TX_STATUS_LABEL, TX_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account, Category, Transaction, TransactionInput, TxStatus, TxType } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TYPES: TxType[] = ["receita", "despesa", "transferencia"];
const STATUSES: TxStatus[] = ["pago", "pendente", "agendado"];

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: TxType;
  initialDate?: string;
  transaction?: Transaction;
}

export function TransactionDialog({ open, onOpenChange, initialType, initialDate, transaction }: TransactionDialogProps) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<TxType>("despesa");
  const [name, setName] = useState("");
  const [valueRaw, setValueRaw] = useState("");
  const [date, setDate] = useState(todayISO());
  const [status, setStatus] = useState<TxStatus>("pago");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [cardId, setCardId] = useState("none");
  const [categoryId, setCategoryId] = useState("none");
  const [fixed, setFixed] = useState(false);
  const [installment, setInstallment] = useState(false);
  const [totalInstallments, setTotalInstallments] = useState("2");
  const [currentInstallment, setCurrentInstallment] = useState("1");
  const [adjustedRaw, setAdjustedRaw] = useState("");
  const [attachment, setAttachment] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    enabled: open,
    staleTime: 60_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    enabled: open,
    staleTime: 60_000,
  });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: open, staleTime: 60_000 });
  const cards = (cardsQuery.data ?? []).filter((c) => c.active);
  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (transaction) {
      setType(transaction.type);
      setName(transaction.name);
      setValueRaw(String(transaction.value));
      setDate(transaction.date);
      setStatus(transaction.status);
      setAccountId(transaction.account_id);
      setToAccountId(transaction.to_account_id ?? "");
      setCardId(transaction.card_id ?? "none");
      setCategoryId(transaction.category_id ?? "none");
      setFixed(transaction.fixed);
      setInstallment(transaction.installment);
      setTotalInstallments(String(transaction.total_installments ?? 2));
      setCurrentInstallment(String(transaction.current_installment ?? 1));
      setAdjustedRaw(transaction.adjusted_value != null ? String(transaction.adjusted_value) : "");
      setAttachment(transaction.attachment ?? "");
      setNotes(transaction.notes ?? "");
    } else {
      setType(initialType ?? "despesa");
      setName("");
      setValueRaw("");
      setDate(initialDate ?? todayISO());
      setStatus("pago");
      setAccountId("");
      setToAccountId("");
      setCardId("none");
      setCategoryId("none");
      setFixed(false);
      setInstallment(false);
      setTotalInstallments("2");
      setCurrentInstallment("1");
      setAdjustedRaw("");
      setAttachment("");
      setNotes("");
    }
  }, [open, transaction, initialType, initialDate]);

  // One less required tap: a new transaction defaults to the first account (still editable).
  useEffect(() => {
    if (open && !transaction && !accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [open, transaction, accountId, accounts]);

  const totalValue = parseAmount(adjustedRaw) ?? parseAmount(valueRaw);
  const installments = installment ? parseInt(totalInstallments, 10) || 0 : 0;
  const installmentValue = installment && totalValue && installments >= 2 ? totalValue / installments : null;

  const mutation = useMutation({
    mutationFn: (input: TransactionInput) =>
      transaction ? updateTransaction(transaction.id, input) : createTransaction(input),
    onSuccess: async () => {
      toast.success(transaction ? "Transação atualizada." : "Transação registrada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
        queryClient.invalidateQueries({ queryKey: ["trends"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const submit = () => {
    setFormError(null);
    const value = parseAmount(valueRaw);
    if (!name.trim()) return setFormError("Dê um nome à transação.");
    if (!value || value <= 0) return setFormError("Informe um valor maior que zero.");
    if (!accountId) return setFormError("Selecione a conta.");
    if (type === "transferencia" && (!toAccountId || toAccountId === accountId))
      return setFormError("Escolha contas diferentes para a transferência.");
    if (installment && installments < 2) return setFormError("O parcelamento precisa de ao menos 2 parcelas.");
    const adjusted = parseAmount(adjustedRaw);
    mutation.mutate({
      name: name.trim(),
      value,
      type,
      status,
      date,
      account_id: accountId,
      card_id: type === "despesa" && cardId !== "none" ? cardId : null,
      to_account_id: type === "transferencia" ? toAccountId : null,
      category_id: categoryId === "none" ? null : categoryId,
      fixed,
      recurrence: fixed ? "mensal" : null,
      installment,
      total_installments: installment ? installments : null,
      current_installment: installment ? Math.max(parseInt(currentInstallment, 10) || 1, 1) : null,
      adjusted_value: adjusted && adjusted > 0 ? adjusted : null,
      attachment: attachment.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">{transaction ? "Editar transação" : "Nova transação"}</DialogTitle>
          <DialogDescription>
            Registre receitas, despesas e transferências com status, categoria e parcelamento.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 && !accountsQuery.isPending ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground" data-testid="tx-no-accounts-warning">
            Cadastre uma conta bancária antes de registrar movimentações.{" "}
            <Link to="/contas" className="font-semibold text-primary hover:underline">
              Ir para Contas
            </Link>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            data-testid="transaction-form"
          >
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tipo da transação">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                    type === t
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  data-testid={`tx-type-${t}`}
                >
                  {TX_TYPE_LABEL[t]}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx-name">Nome</Label>
              <Input
                id="tx-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Mercado, Salário, Aluguel"
                maxLength={80}
                data-testid="tx-name-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tx-value">Valor (R$)</Label>
                <Input
                  id="tx-value"
                  inputMode="decimal"
                  value={valueRaw}
                  onChange={(e) => setValueRaw(e.target.value)}
                  placeholder="0,00"
                  data-testid="tx-value-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-date">Data</Label>
                <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="tx-date-input" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tx-account">{type === "transferencia" ? "Conta de origem" : "Conta"}</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="tx-account" className="w-full" aria-label="Conta" data-testid="tx-account-select">
                    <SelectValue>
                      {accountId ? (accounts.find((a) => a.id === accountId)?.name ?? "") : "Selecione"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type === "transferencia" ? (
                <div className="space-y-2">
                  <Label htmlFor="tx-to-account">Conta de destino</Label>
                  <Select value={toAccountId} onValueChange={setToAccountId}>
                    <SelectTrigger id="tx-to-account" className="w-full" aria-label="Conta de destino" data-testid="tx-to-account-select">
                      <SelectValue>
                        {toAccountId ? (accounts.find((a) => a.id === toAccountId)?.name ?? "") : "Selecione"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {accounts
                        .filter((a) => a.id !== accountId)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="tx-status">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as TxStatus)}>
                    <SelectTrigger id="tx-status" className="w-full" aria-label="Status" data-testid="tx-status-select">
                      <SelectValue>{TX_STATUS_LABEL[status]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {TX_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {type === "despesa" && cards.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="tx-card">Cartão usado (opcional)</Label>
                <Select value={cardId} onValueChange={setCardId}>
                  <SelectTrigger id="tx-card" className="w-full" aria-label="Cartão usado" data-testid="tx-card-select">
                    <SelectValue>
                      {cardId === "none" ? "Sem cartão" : (cards.find((c) => c.id === cardId)?.name ?? "")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem cartão</SelectItem>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Marcar o cartão soma a despesa à fatura dele — a conta acima continua sendo a de pagamento.
                </p>
              </div>
            ) : null}

            {type !== "transferencia" ? (
              <div className="space-y-2">
                <Label htmlFor="tx-category">Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="tx-category" className="w-full" aria-label="Categoria" data-testid="tx-category-select">
                    <SelectValue>
                      {categoryId !== "none" ? (categories.find((c) => c.id === categoryId)?.name ?? "") : "Sem categoria"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {type === "despesa" ? (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <Checkbox id="tx-fixed" checked={fixed} onCheckedChange={(checked) => setFixed(checked === true)} data-testid="tx-fixed-checkbox" />
                  <div>
                    <Label htmlFor="tx-fixed" className="font-normal">
                      Despesa fixa
                    </Label>
                    <p className="text-xs text-muted-foreground">Repete todo mês (aluguel, internet, streaming…)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="tx-installment"
                    checked={installment}
                    onCheckedChange={(checked) => setInstallment(checked === true)}
                    data-testid="tx-installment-checkbox"
                  />
                  <div>
                    <Label htmlFor="tx-installment" className="font-normal">
                      Parcelado
                    </Label>
                    <p className="text-xs text-muted-foreground">As parcelas futuras não somam no saldo atual.</p>
                  </div>
                </div>
                {installment ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="tx-installments">Total de parcelas</Label>
                      <Input
                        id="tx-installments"
                        type="number"
                        min={2}
                        max={120}
                        value={totalInstallments}
                        onChange={(e) => setTotalInstallments(e.target.value)}
                        data-testid="tx-installments-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tx-current-installment">Parcela atual</Label>
                      <Input
                        id="tx-current-installment"
                        type="number"
                        min={1}
                        value={currentInstallment}
                        onChange={(e) => setCurrentInstallment(e.target.value)}
                        data-testid="tx-current-installment-input"
                      />
                    </div>
                    {installmentValue ? (
                      <p className="col-span-2 text-sm text-muted-foreground" data-testid="tx-installment-preview">
                        {installments}x de <strong className="font-heading text-foreground">{formatBRL(installmentValue)}</strong>
                        {adjustedRaw ? "" : ` · total ${formatBRL(totalValue ?? 0)}`}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tx-adjusted">Valor ajustado (opcional)</Label>
                <Input
                  id="tx-adjusted"
                  inputMode="decimal"
                  value={adjustedRaw}
                  onChange={(e) => setAdjustedRaw(e.target.value)}
                  placeholder="Ex.: 5.998,80"
                  data-testid="tx-adjusted-value-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-attachment">Anexo (link, opcional)</Label>
                <Input
                  id="tx-attachment"
                  value={attachment}
                  onChange={(e) => setAttachment(e.target.value)}
                  placeholder="https://…"
                  maxLength={300}
                  data-testid="tx-attachment-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx-notes">Observação</Label>
              <Textarea
                id="tx-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                data-testid="tx-notes-input"
              />
            </div>

            {formError ? (
              <p role="alert" className="text-sm font-medium text-destructive" data-testid="tx-form-error">
                {formError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending} data-testid="tx-cancel-button">
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="tx-submit-button">
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : transaction ? "Salvar alterações" : "Registrar transação"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
