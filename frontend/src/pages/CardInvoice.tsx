import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOwnHeader } from "@/components/layout/BackButton";
import { CardAnalysis } from "@/components/wallet/CardAnalysis";
import { openRegisterSheet } from "@/lib/registerSheet";
import { askAbout } from "@/lib/askAi";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Paperclip, Search, RotateCcw, MessageCircleMore } from "lucide-react";
import { toast } from "sonner";
import { fetchAccounts, fetchCards, fetchInvoice, undoInvoicePayment, creditInvoice, refundInvoiceToBank } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, formatDate, formatHiddenBRL, parseAmount } from "@/lib/format";
import type { CreditInvoiceInput, BankRefundInput } from "@/types/finnos";
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
  const { hidden, toggle: toggleHidden } = useBalanceHidden();
  useOwnHeader();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditPurchaseId, setCreditPurchaseId] = useState("");
  const [creditAmountRaw, setCreditAmountRaw] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditOperationId, setCreditOperationId] = useState(() => crypto.randomUUID());
  const [creditError, setCreditError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  // A reminder links to a specific invoice: ?cycle=YYYY-MM-DD (its closing date).
  const [cycleMonth, setCycleMonth] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("cycle") ?? "") ? searchParams.get("cycle")!.slice(0, 7) : "");
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
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  // Carteira "Pagar fatura" (?pagar=1) opens the payment as soon as the invoice is read.
  const openedPay = useRef(false);
  useEffect(() => {
    if (openedPay.current || searchParams.get("pagar") !== "1" || !invoice) return;
    openedPay.current = true;
    if ((invoice.outstanding ?? 0) > 0) openRegisterSheet({ invoice: { cardId, cycle: invoice.cycle_end } });
  }, [invoice, searchParams, cardId]);

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

  const refreshMoney = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["invoice", cardId] }),
    queryClient.invalidateQueries({ queryKey: ["cards"] }),
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    queryClient.invalidateQueries({ queryKey: ["calendar"] }),
    queryClient.invalidateQueries({ queryKey: ["flow"] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  ]);

  const undoMutation = useMutation({
    mutationFn: (paymentId: string) => undoInvoicePayment(cardId, paymentId),
    onSuccess: async () => {
      toast.success("Pagamento desfeito. O valor voltou para a conta com um estorno.");
      await refreshMoney();
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
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

  const owed = invoice.outstanding ?? invoice.total - invoice.paid_amount;
  const shown = showAll ? items : items.slice(0, 6);
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3.5" data-testid="card-invoice-page">
      <header className="flex items-center gap-3">
        <Link to="/contas?aba=cartoes" aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></Link>
        <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-bold" data-testid="invoice-card-name">{card ? `${card.institution || card.name} · Crédito` : invoice.card_name}</h1>
        <button type="button" aria-label="Perguntar na Conversa" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-primary"
          onClick={() => askAbout(`Me ajude a entender a fatura do ${invoice.card_name}: total, o que mais pesou e as parcelas.`,
            { cartao: invoice.card_name, total: invoice.total, em_aberto: owed, vence: invoice.due_date, compras: invoice.items.slice(0, 30).map((i) => ({ nome: i.name, valor: i.value, categoria: i.category_name })) })}>
          <MessageCircleMore className="size-[18px]" />
        </button>
        <button type="button" onClick={toggleHidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card">
          {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </header>

      {card ? <CardAnalysis card={card} selectedCycle={invoice.cycle_end} onPick={(closing) => setCycleMonth(closing.slice(0, 7))} hidden={hidden} /> : null}

      <section className="rounded-3xl border border-border bg-card p-4" data-testid="invoice-selected">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Fatura selecionada</p>
            <p className="mt-1 text-[13px] text-muted-foreground" data-testid="invoice-cycle">Ciclo de {formatDate(invoice.cycle_start)} a {formatDate(invoice.cycle_end)} · vence {formatDate(invoice.due_date)}</p>
          </div>
          <p className="shrink-0 font-heading text-2xl font-bold tabular-nums" data-testid="invoice-total">{money(invoice.total)}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {invoice.paid ? (
            <Badge className="gap-1.5 bg-income/15 text-income" data-testid="invoice-paid-badge">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Paga em {invoice.paid_at ? formatDate(invoice.paid_at) : "—"}
            </Badge>
          ) : null}
          {invoice.reconciled ? <Badge variant="secondary" data-testid="invoice-reconciled">Conferida</Badge> : null}
        </div>
        {invoice.paid_amount > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="invoice-paid-amount">Pago: {money(invoice.paid_amount)} · Em aberto: {money(owed)}</p>
        ) : null}
        {(invoice.carried_amount ?? 0) > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-carried">
            Pago parcialmente: {money(invoice.carried_amount ?? 0)} foi para a fatura que fecha em{" "}
            {invoice.carried_to ? formatDate(invoice.carried_to) : "—"} como “Saldo da fatura anterior”.
          </p>
        ) : null}
        {(invoice.adjustment_total ?? 0) > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="invoice-credits-total">Créditos auditados nesta fatura: {money(invoice.adjustment_total ?? 0)}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {invoice.last_payment_id && invoice.paid_amount > 0 ? (
            <Button size="sm" variant="outline" className="rounded-full" disabled={undoMutation.isPending}
              onClick={() => undoMutation.mutate(invoice.last_payment_id!)} data-testid="undo-payment-button">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Desfazer último pagamento
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setCreditOpen(true)}
            disabled={owed <= 0 || invoice.items.length === 0} data-testid="credit-invoice-button">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Registrar estorno
          </Button>
          {invoice.paid ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setRefundOpen(true)} data-testid="bank-refund-button">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Registrar reembolso
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Label htmlFor="invoice-cycle-month" className="text-xs text-muted-foreground">Outro mês (fechamento)</Label>
          <Input id="invoice-cycle-month" type="month" className="h-9 w-40" value={cycleMonth} disabled={!card} onChange={event => setCycleMonth(event.target.value)} data-testid="invoice-cycle-month" />
          {cycleMonth ? <Button size="sm" variant="ghost" onClick={() => setCycleMonth("")}>Fatura atual</Button> : null}
        </div>
        {invoice.paid ? (
          <p className="mt-2 text-xs text-muted-foreground">Para estornar compras de faturas já quitadas, registre um reembolso bancário.</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-card" data-testid="invoice-items-section">
        <h2 className="px-4 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Lançamentos neste cartão</h2>
        {invoice.items.length > 6 ? (
          <div className="relative mx-4 my-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar compra nesta fatura…" className="h-10 rounded-full pl-9"
              aria-label="Buscar compra nesta fatura" data-testid="invoice-search-input" />
          </div>
        ) : null}
        <ul data-testid="invoice-items">
          {shown.map((item, i) => (
            <li key={`${item.id}-${item.date}`} className={cn("flex items-center gap-3 px-4 py-2.5", i > 0 && "border-t border-border/60")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{item.name}{item.installment_label ? ` · ${item.installment_label}` : ""}</span>
                <span className="block text-xs text-muted-foreground">{formatDate(item.date).slice(0, 5)} · {item.category_name ?? "Sem categoria"}</span>
              </span>
              <strong className="shrink-0 text-sm tabular-nums">{money(item.value)}</strong>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="invoice-empty">
              {invoice.items.length === 0 ? "Nenhuma compra neste ciclo." : "Nenhuma compra com esse nome."}
            </li>
          ) : null}
        </ul>
        {items.length > shown.length ? (
          <button type="button" onClick={() => setShowAll(true)} className="block w-full border-t border-border/60 px-4 py-3.5 text-left text-sm font-semibold text-primary" data-testid="invoice-show-all">
            Ver todos os {items.length} lançamentos
          </button>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <Button className="h-[50px] rounded-full text-sm font-bold" onClick={() => openRegisterSheet({ invoice: { cardId, cycle: invoice.cycle_end } })} disabled={owed <= 0} data-testid="pay-invoice-button">Pagar fatura</Button>
        <Link to={`/cartoes/${encodeURIComponent(cardId)}/configurar`} className="grid h-[50px] place-items-center rounded-full border border-border bg-card text-sm font-bold" data-testid="card-configure-link">Configurar cartão</Link>
      </div>
      <Link to={`/cartoes/${encodeURIComponent(cardId)}/conferencia?cycle=${invoice.cycle_end}`} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary/10 text-sm font-bold text-primary" data-testid="invoice-reconcile-link">
        <Paperclip className="size-4" aria-hidden="true" />Conferir com a fatura do banco
      </Link>
      <p className="px-2 text-center text-xs text-muted-foreground">Ao pagar, você escolhe de qual conta sai. O pagamento não conta como gasto de novo.</p>

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

    </div>
  );
}
