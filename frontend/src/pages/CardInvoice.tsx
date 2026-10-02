import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { fetchAccounts, fetchInvoice, payInvoice } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, formatDate, formatHiddenBRL, parseAmount } from "@/lib/format";
import type { PayInvoiceInput } from "@/types/finnos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function CardInvoice() {
  const { cardId = "" } = useParams();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [payDate, setPayDate] = useState("");
  const [valueRaw, setValueRaw] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const invoiceQuery = useQuery({ queryKey: ["invoice", cardId], queryFn: () => fetchInvoice(cardId) });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, staleTime: 60_000 });
  const invoice = invoiceQuery.data;
  const accounts = accountsQuery.data ?? [];
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  // Defaults the user can change: the invoice due date and the first account.
  useEffect(() => {
    if (!payOpen || !invoice) return;
    setFormError(null);
    setPayDate(invoice.due_date);
    setValueRaw(String(invoice.total));
    setAccountId((current) => current || accounts[0]?.id || "");
  }, [payOpen, invoice, accounts]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (invoice?.items ?? []).filter((item) => !term || item.name.toLowerCase().includes(term));
  }, [invoice, search]);

  const payMutation = useMutation({
    mutationFn: (input: PayInvoiceInput) => payInvoice(cardId, input),
    onSuccess: async () => {
      toast.success("Fatura marcada como paga e débito lançado na conta.");
      setPayOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice", cardId] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  if (invoiceQuery.isPending) {
    return <div className="h-80 animate-pulse rounded-3xl bg-muted" aria-hidden="true" />;
  }
  if (invoiceQuery.error || !invoice) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground" data-testid="invoice-error-message">
          Não foi possível carregar esta fatura.
        </p>
        <Button variant="outline" className="mt-3" onClick={() => invoiceQuery.refetch()} data-testid="invoice-retry-button">
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl" data-testid="invoice-card-name">
            Fatura · {invoice.card_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-cycle">
            Ciclo de {formatDate(invoice.cycle_start)} a {formatDate(invoice.cycle_end)} · vence{" "}
            {formatDate(invoice.due_date)}
          </p>
        </div>
        {invoice.paid ? (
          <Badge className="gap-1.5 bg-income/15 text-income" data-testid="invoice-paid-badge">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Paga em {invoice.paid_at ? formatDate(invoice.paid_at) : "—"}
          </Badge>
        ) : (
          <Button onClick={() => setPayOpen(true)} disabled={invoice.total <= 0} data-testid="pay-invoice-button">
            Marcar como paga
          </Button>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total da fatura</p>
        <p className="mt-1 font-heading text-3xl font-bold tabular-nums text-foreground" data-testid="invoice-total">
          {money(invoice.total)}
        </p>
        {invoice.paid ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-paid-amount">
            Pago: {money(invoice.paid_amount)}
          </p>
        ) : null}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar compra nesta fatura…"
          className="pl-9"
          aria-label="Buscar compra nesta fatura"
          data-testid="invoice-search-input"
        />
      </div>

      <ul className="space-y-2" data-testid="invoice-items">
        {items.map((item) => (
          <li key={`${item.id}-${item.date}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.category_color ?? "#94A3B8" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {item.name}
                {item.installment_label ? (
                  <span className="ml-2 text-xs text-muted-foreground">parcela {item.installment_label}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(item.date)} · {item.category_name ?? "Sem categoria"}
              </p>
            </div>
            <p className="shrink-0 font-heading text-sm font-bold tabular-nums text-foreground">{money(item.value)}</p>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground" data-testid="invoice-empty">
            {invoice.items.length === 0 ? "Nenhuma compra neste ciclo." : "Nenhuma compra com esse nome."}
          </li>
        ) : null}
      </ul>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Pagar fatura</DialogTitle>
            <DialogDescription>
              Lançamos uma despesa “Fatura {invoice.card_name}” na conta escolhida, já como paga. Ela não volta para a
              fatura.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              const value = parseAmount(valueRaw);
              if (!accountId) return setFormError("Selecione a conta que vai pagar.");
              if (!value || value <= 0) return setFormError("Informe o valor pago.");
              payMutation.mutate({ account_id: accountId, date: payDate, value });
            }}
            data-testid="pay-invoice-form"
          >
            <div className="space-y-2">
              <Label htmlFor="pay-account">Conta de pagamento</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="pay-account" className="w-full" aria-label="Conta de pagamento" data-testid="pay-account-select">
                  <SelectValue>{accounts.find((a) => a.id === accountId)?.name ?? "Selecione"}</SelectValue>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pay-date">Data do pagamento</Label>
                <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} data-testid="pay-date-input" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-value">Valor pago (R$)</Label>
                <Input
                  id="pay-value"
                  inputMode="decimal"
                  value={valueRaw}
                  onChange={(e) => setValueRaw(e.target.value)}
                  data-testid="pay-value-input"
                />
              </div>
            </div>
            {formError ? (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="pay-invoice-error">
                {formError}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)} data-testid="pay-cancel-button">
                Cancelar
              </Button>
              <Button type="submit" disabled={payMutation.isPending} data-testid="pay-confirm-button">
                {payMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Confirmar pagamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
