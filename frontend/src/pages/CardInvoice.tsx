import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Search, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { fetchAccounts, fetchCards, fetchInvoice, payInvoice, creditInvoice, refundInvoiceToBank } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, formatDate, formatHiddenBRL, parseAmount } from "@/lib/format";
import type { PayInvoiceInput, CreditInvoiceInput, BankRefundInput } from "@/types/finnos";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
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
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditPurchaseId, setCreditPurchaseId] = useState("");
  const [creditAmountRaw, setCreditAmountRaw] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditOperationId, setCreditOperationId] = useState(() => crypto.randomUUID());
  const [creditError, setCreditError] = useState<string | null>(null);
  const [cycleMonth, setCycleMonth] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundPurchaseId, setRefundPurchaseId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [refundDate, setRefundDate] = useState("");
  const [refundOperationId, setRefundOperationId] = useState(() => crypto.randomUUID());
  const [refundError, setRefundError] = useState<string | null>(null);

  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards, staleTime: 60_000 });
  const card = cardsQuery.data?.find(item => item.id === cardId);
  const cycle = cycleMonth && card ? (() => {
    const [year, month] = cycleMonth.split("-").map(Number);
    const last = new Date(year, month, 0).getDate();
    return `${cycleMonth}-${String(Math.min(card.closing_day, last)).padStart(2, "0")}`;
  })() : undefined;
  const invoiceQuery = useQuery({
    queryKey: ["invoice", cardId, cycle ?? "default"],
    queryFn: () => fetchInvoice(cardId, cycle),
  });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, staleTime: 60_000 });
  const invoice = invoiceQuery.data;
  const accounts = accountsQuery.data ?? [];
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  // Defaults the user can change: the invoice due date and the first account.
  useEffect(() => {
    if (!payOpen || !invoice) return;
    setFormError(null);
    setPayDate(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }));
    setValueRaw(String(invoice.outstanding ?? invoice.total - invoice.paid_amount));
    setOperationId(crypto.randomUUID());
    setAccountId((current) => current || accounts[0]?.id || "");
  }, [payOpen, invoice, accounts]);

  useEffect(() => {
    if (!creditOpen || !invoice) return;
    const first = invoice.items[0];
    setCreditPurchaseId(first?.id ?? "");
    const alreadyCredited = (invoice.adjustments ?? [])
      .filter(item => item.purchase_id === first?.id)
      .reduce((sum, item) => sum + item.value, 0);
    const available = Math.min(
      Math.max((first?.value ?? 0) - alreadyCredited, 0),
      invoice.outstanding ?? invoice.total - invoice.paid_amount,
    );
    setCreditAmountRaw(available > 0 ? String(Math.round(available * 100) / 100) : "");
    setCreditReason("");
    setCreditError(null);
    setCreditOperationId(crypto.randomUUID());
  }, [creditOpen, invoice]);

  useEffect(() => {
    if (!refundOpen || !invoice) return;
    const first = invoice.items[0];
    setRefundPurchaseId(first?.id ?? "");
    const previous = (invoice.refunds ?? []).filter(r => r.purchase_id === first?.id)
      .reduce((sum, r) => sum + r.value, 0);
    setRefundAmount(first ? String(Math.max(0, first.value - previous)) : "");
    setRefundReason("");
    setRefundAccountId(accounts[0]?.id ?? "");
    setRefundDate(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }));
    setRefundOperationId(crypto.randomUUID());
    setRefundError(null);
  }, [refundOpen, invoice, accounts]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (invoice?.items ?? []).filter((item) => !term || item.name.toLowerCase().includes(term));
  }, [invoice, search]);

  const payMutation = useMutation({
    mutationFn: (input: PayInvoiceInput) => payInvoice(cardId, input, operationId),
    onSuccess: async () => {
      toast.success("Pagamento registrado e débito lançado na conta.");
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

  const creditMutation = useMutation({
    mutationFn: (input: CreditInvoiceInput) => creditInvoice(cardId, input, creditOperationId),
    onSuccess: async () => {
      toast.success("Crédito registrado. Compra e pagamentos originais preservados.");
      setCreditOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice", cardId] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
      ]);
    },
    onError: (error) => setCreditError(getApiErrorMessage(error)),
  });

  const refundMutation = useMutation({
    mutationFn: (input: BankRefundInput) => refundInvoiceToBank(cardId, input, refundOperationId),
    onSuccess: async () => {
      toast.success("Reembolso bancário registrado sem alterar a fatura quitada.");
      setRefundOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice", cardId] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
        queryClient.invalidateQueries({ queryKey: ["flow"] }),
        queryClient.invalidateQueries({ queryKey: ["radar"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-history"] }),
      ]);
    },
    onError: (error) => setRefundError(getApiErrorMessage(error)),
  });

  if (invoiceQuery.isPending) {
    return <FinnosPageLoading title="Carregando fatura" description="Atualizando compras, pagamentos e total aberto." />;
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Label htmlFor="invoice-cycle-month" className="text-xs text-muted-foreground">
              Consultar histórico (mês de fechamento)
            </Label>
            <Input id="invoice-cycle-month" type="month" className="w-44"
              value={cycleMonth} disabled={!card} onChange={event => setCycleMonth(event.target.value)}
              data-testid="invoice-cycle-month" />
            {cycleMonth && <Button size="sm" variant="ghost" onClick={() => setCycleMonth("")}>Fatura padrão</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {invoice.paid ? (
            <>
              <Badge className="gap-1.5 bg-income/15 text-income" data-testid="invoice-paid-badge">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Paga em {invoice.paid_at ? formatDate(invoice.paid_at) : "—"}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => setRefundOpen(true)}
                data-testid="bank-refund-button">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Registrar reembolso
              </Button>
            </>
          ) : (
            <Button onClick={() => setPayOpen(true)} disabled={(invoice.outstanding ?? 0) <= 0} data-testid="pay-invoice-button">
              Registrar pagamento
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setCreditOpen(true)}
            disabled={(invoice.outstanding ?? 0) <= 0 || invoice.items.length === 0}
            data-testid="credit-invoice-button"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Registrar estorno
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total da fatura</p>
        <p className="mt-1 font-heading text-3xl font-bold tabular-nums text-foreground" data-testid="invoice-total">
          {money(invoice.total)}
        </p>
        {invoice.paid_amount > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-paid-amount">
            Pago: {money(invoice.paid_amount)} · Em aberto: {money(invoice.outstanding ?? invoice.total - invoice.paid_amount)}
          </p>
        ) : null}
        {(invoice.adjustment_total ?? 0) > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-credits-total">
            Créditos auditados nesta fatura: {money(invoice.adjustment_total ?? 0)}
          </p>
        ) : null}
        {invoice.paid ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Para estornar compras de faturas já quitadas, será necessário registrar um reembolso bancário em fluxo específico.
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

      {(invoice.adjustments ?? []).length > 0 ? (
        <section className="rounded-3xl border border-border bg-card p-5" data-testid="invoice-credits-history">
          <h2 className="font-heading text-base font-semibold">Histórico de estornos</h2>
          <ul className="mt-3 space-y-3">
            {(invoice.adjustments ?? []).map(item => (
              <li key={item.id} className="flex items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium">{item.reason}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(item.date)} · {invoice.items.find(p => p.id === item.purchase_id)?.name ?? "Compra original"}</p>
                </div>
                <span className="shrink-0 font-semibold text-income">− {money(item.value)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(invoice.refunds ?? []).length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-5" data-testid="invoice-refunds-history">
          <h2 className="font-heading text-base font-semibold">Reembolsos bancários</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Devoluções confirmadas na conta, sem alterar a fatura originalmente quitada.
          </p>
          <ul className="mt-3 space-y-3">
            {(invoice.refunds ?? []).map(item => (
              <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{item.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(item.date)} · {invoice.items.find(p => p.id === item.purchase_id)?.name ?? "Compra"}
                  </p>
                </div>
                <span className="font-semibold text-income">+ {money(item.value)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar reembolso bancário</DialogTitle>
            <DialogDescription>
              Uma receita de reembolso será lançada na conta escolhida. Não é renda nova
              nem altera a fatura paga; a devolução fica vinculada à compra original.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            setRefundError(null);
            const value = parseAmount(refundAmount);
            const selected = invoice.items.find(item => item.id === refundPurchaseId);
            const refunded = (invoice.refunds ?? []).filter(item => item.purchase_id === refundPurchaseId)
              .reduce((sum, item) => sum + item.value, 0);
            const adjusted = (invoice.adjustments ?? []).filter(item => item.purchase_id === refundPurchaseId)
              .reduce((sum, item) => sum + item.value, 0);
            if (!selected) return setRefundError("Selecione a compra reembolsada.");
            if (!refundAccountId) return setRefundError("Selecione a conta de recebimento.");
            if (!value || value <= 0 || value > selected.value - refunded - adjusted + 1e-6)
              return setRefundError("Valor excede o saldo reembolsável desta compra.");
            if (refundReason.trim().length < 5) return setRefundError("Informe o motivo.");
            refundMutation.mutate({ cycle: invoice.cycle_end, purchase_id: refundPurchaseId,
              account_id: refundAccountId, date: refundDate, value, reason: refundReason.trim() });
          }} data-testid="bank-refund-form">
            <div className="space-y-2">
              <Label htmlFor="refund-purchase">Compra</Label>
              <Select value={refundPurchaseId} onValueChange={setRefundPurchaseId}>
                <SelectTrigger id="refund-purchase"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>{invoice.items.map(item =>
                  <SelectItem key={item.id} value={item.id}>{item.name} · {money(item.value)}</SelectItem>
                )}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-account">Conta de recebimento</Label>
              <Select value={refundAccountId} onValueChange={setRefundAccountId}>
                <SelectTrigger id="refund-account"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>{accounts.map(account =>
                  <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                )}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="refund-date">Data</Label>
                <Input id="refund-date" type="date" value={refundDate} onChange={event => setRefundDate(event.target.value)} />
              </div>
              <div className="space-y-2"><Label htmlFor="refund-amount">Valor (R$)</Label>
                <Input id="refund-amount" inputMode="decimal" value={refundAmount} onChange={event => setRefundAmount(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2"><Label htmlFor="refund-reason">Motivo</Label>
              <Input id="refund-reason" value={refundReason} onChange={event => setRefundReason(event.target.value)} maxLength={300}
                placeholder="Ex.: Produto devolvido à loja" />
            </div>
            {refundError && <p className="text-sm text-destructive" role="alert">{refundError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={refundMutation.isPending} data-testid="bank-refund-confirm">
                {refundMutation.isPending ? "Registrando..." : "Confirmar reembolso"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Registrar estorno no cartão</DialogTitle>
            <DialogDescription>
              O crédito reduz somente o saldo não pago desta fatura. A compra e os pagamentos anteriores
              permanecem no histórico. Não há devolução automática para a conta bancária.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            setCreditError(null);
            const value = parseAmount(creditAmountRaw);
            const purchase = invoice.items.find(item => item.id === creditPurchaseId);
            const alreadyCredited = (invoice.adjustments ?? [])
              .filter(item => item.purchase_id === creditPurchaseId)
              .reduce((sum, item) => sum + item.value, 0);
            if (!purchase) return setCreditError("Selecione uma compra nesta fatura.");
            if (!value || value <= 0) return setCreditError("Informe um valor positivo.");
            if (value > Math.min(purchase.value - alreadyCredited, invoice.outstanding ?? 0) + 1e-6) {
              return setCreditError("Valor maior que o saldo da compra ou da fatura.");
            }
            if (creditReason.trim().length < 5) return setCreditError("Descreva o motivo do estorno.");
            creditMutation.mutate({
              cycle: invoice.cycle_end, purchase_id: creditPurchaseId,
              value, reason: creditReason.trim(),
            });
          }} data-testid="credit-invoice-form">
            <div className="space-y-2">
              <Label htmlFor="credit-purchase">Compra ou parcela</Label>
              <Select value={creditPurchaseId} onValueChange={(id) => {
                setCreditPurchaseId(id);
                const selected = invoice.items.find(item => item.id === id);
                const prior = (invoice.adjustments ?? []).filter(item => item.purchase_id === id)
                  .reduce((sum, item) => sum + item.value, 0);
                const limit = Math.min(Math.max((selected?.value ?? 0) - prior, 0), invoice.outstanding ?? 0);
                setCreditAmountRaw(limit > 0 ? String(Math.round(limit * 100) / 100) : "");
              }}>
                <SelectTrigger id="credit-purchase" className="w-full" data-testid="credit-purchase-select">
                  <SelectValue>{invoice.items.find(item => item.id === creditPurchaseId)?.name ?? "Selecione a compra"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {invoice.items.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}{item.installment_label ? ` · ${item.installment_label}` : ""} · {money(item.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-amount">Valor do crédito (R$)</Label>
              <Input id="credit-amount" inputMode="decimal" value={creditAmountRaw}
                onChange={(event) => setCreditAmountRaw(event.target.value)} data-testid="credit-amount-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-reason">Motivo do estorno</Label>
              <Input id="credit-reason" maxLength={300} value={creditReason}
                onChange={(event) => setCreditReason(event.target.value)}
                placeholder="Ex.: Produto devolvido à loja" data-testid="credit-reason-input" />
            </div>
            {creditError ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{creditError}</p> : null}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCreditOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={creditMutation.isPending} data-testid="credit-confirm-button">
                {creditMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Confirmar estorno
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              payMutation.mutate({ account_id: accountId, date: payDate, value, cycle: invoice.cycle_end });
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
