import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff, Info, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cardGradient } from "@/lib/cardGradient";
import { bankInitials } from "@/lib/walletSummary";
import { defaultAccount } from "@/lib/walletDefaults";
import { formatBRL, formatHiddenBRL, parseAmount } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";
import type { Account, CreditCard, Invoice, PayInvoiceInput } from "@/types/finnos";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export interface PaidSummary { value: number; accountId: string; scheduled: boolean }

/** Prototype "7 · Pagar fatura": how much, from which account (balance after), when, and the receipt.
 * "No vencimento" is only a reminder (decision): nothing is recorded until the person confirms. */
export function PayInvoiceSheet({ open, onOpenChange, invoice, card, accounts, pending, error, overdraftMessage, onPay, done, onUndo, onDoneClose }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
  card?: CreditCard;
  accounts: Account[];
  pending: boolean;
  error: string | null;
  /** The server asked to confirm the cheque especial. */
  overdraftMessage: string | null;
  onPay: (input: PayInvoiceInput, scheduled: boolean) => void;
  done: PaidSummary | null;
  onUndo: () => void;
  onDoneClose: () => void;
}) {
  const { hidden, toggle } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : (v < 0 ? "− " : "") + formatBRL(Math.abs(v)));
  const owed = Math.round((invoice.outstanding ?? invoice.total - invoice.paid_amount) * 100) / 100;
  const minimum = invoice.minimum_payment && invoice.minimum_payment < owed ? invoice.minimum_payment : null;
  const [amount, setAmount] = useState<"full" | "min" | "other">("full");
  const [other, setOther] = useState("");
  const [when, setWhen] = useState<"now" | "due">("now");
  const payers = useMemo(() => accounts.filter((a) => a.active && a.type !== "beneficio"), [accounts]);
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    if (!open) return;
    setAmount("full"); setOther(""); setWhen("now");
    const suggested = payers.find((a) => a.id === card?.payment_account_id)?.id;
    setAccountId(suggested || defaultAccount(payers)?.id || payers[0]?.id || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = amount === "full" ? owed : amount === "min" ? minimum ?? owed : parseAmount(other || "0") ?? 0;
  const closed = invoice.cycle_end < today();
  const partial = pay > 0 && pay < owed;
  const cover = (a: Account) => {
    const after = Math.round((a.balance - pay) * 100) / 100;
    const limit = a.overdraft_limit ?? 0;
    return { after, short: after < 0 && -after > limit, overdraft: after < 0 && -after <= limit };
  };
  const payer = payers.find((a) => a.id === accountId);
  const invalid = !(pay > 0) || pay > owed || !payer || cover(payer).short;
  const submit = () => {
    if (invalid || !payer) return;
    onPay({ cycle: invoice.cycle_end, account_id: payer.id, date: when === "now" ? today() : invoice.due_date, value: pay }, when === "due");
  };
  const cycleName = MONTHS[Number(invoice.cycle_end.slice(5, 7)) - 1];
  const option = (on: boolean) => cn("flex w-full items-center gap-3 rounded-[18px] px-4 py-3.5 text-left", on ? "border-2 border-primary bg-primary/[0.07]" : "border border-border bg-card");
  const radio = (on: boolean) => cn("size-5 shrink-0 rounded-full", on ? "border-[6px] border-primary" : "border-2 border-primary/30");
  const section = "mx-1 mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground";
  const doneAccount = done ? accounts.find((a) => a.id === done.accountId) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[560px] flex-col gap-0 overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[92dvh] sm:rounded-[30px] [&>button:last-child]:hidden" data-testid="pay-invoice-form">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="grid size-11 place-items-center rounded-full border border-border bg-card" data-testid="pay-cancel-button"><X className="size-5" /></button>
          <DialogTitle className="flex-1 font-heading text-xl font-bold">Pagar fatura</DialogTitle>
          <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-11 place-items-center rounded-full border border-border bg-card">{hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
        </div>
        <DialogDescription className="sr-only">Escolha o valor, a conta e quando pagar.</DialogDescription>

        {done ? (
          <div data-testid="pay-done">
            <div className="flex flex-col items-center px-4 pt-14 text-center">
              <span className="grid size-[84px] place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15"><Check className="size-10" strokeWidth={2.4} /></span>
              <h2 className="mt-5 font-heading text-[26px] font-bold">{done.scheduled ? "Pagamento agendado" : "Fatura paga"}</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">{done.scheduled ? `Vamos lembrar você no dia ${ddmm(invoice.due_date)} e registrar quando confirmar.` : "Registramos o pagamento e o limite volta a ficar livre."}</p>
            </div>
            <div className="mt-7 overflow-hidden rounded-3xl border border-border bg-card text-sm">
              <div className="flex justify-between px-4 py-3.5"><span className="text-muted-foreground">Valor</span><strong className="tabular-nums">{money(done.value)}</strong></div>
              <div className="flex justify-between border-t border-border/60 px-4 py-3.5"><span className="text-muted-foreground">{done.scheduled ? "Vai sair de" : "Saiu de"}</span><strong>{doneAccount?.name ?? "—"}</strong></div>
              <div className="flex justify-between border-t border-border/60 px-4 py-3.5"><span className="text-muted-foreground">Saldo depois</span><strong className="tabular-nums">{doneAccount ? money(done.scheduled ? doneAccount.balance - done.value : doneAccount.balance) : "—"}</strong></div>
              <div className="flex justify-between border-t border-border/60 px-4 py-3.5"><span className="text-muted-foreground">Nos gastos do mês</span><strong>Não muda</strong></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {!done.scheduled ? <button type="button" onClick={onUndo} className="h-[50px] rounded-full border border-border bg-card text-sm font-bold" data-testid="pay-undo">Desfazer</button> : <span />}
              <Link to="/contas" onClick={onDoneClose} className="grid h-[50px] place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">Voltar à Carteira</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3.5 flex items-center gap-3.5 rounded-3xl p-4 text-white" style={{ background: cardGradient(card?.color ?? "#4B2CFF") }}>
              <span className="grid h-9 w-[52px] place-items-center rounded-lg bg-white/20 text-[11px] font-bold">{card?.last_digits ?? "••••"}</span>
              <span className="flex-1"><span className="block text-[15px] font-bold">Fatura {card?.institution || invoice.card_name} · {cycleName}</span>
                <span className="block text-xs opacity-85">{closed ? "Fechou" : "Fecha"} dia {Number(invoice.cycle_end.slice(8, 10))} · vence {ddmm(invoice.due_date)}</span></span>
            </div>

            <h3 className={section}>Quanto vai pagar?</h3>
            <div className="flex flex-col gap-2">
              <button type="button" className={option(amount === "full")} aria-pressed={amount === "full"} onClick={() => setAmount("full")} data-testid="pay-full-button">
                <span className={radio(amount === "full")} /><span className="flex-1"><span className="block text-[15px] font-bold">Fatura inteira</span><span className="block text-xs text-muted-foreground">Sem juros</span></span><strong className="tabular-nums">{money(owed)}</strong>
              </button>
              {minimum ? (
                <button type="button" className={option(amount === "min")} aria-pressed={amount === "min"} onClick={() => setAmount("min")} data-testid="pay-minimum-button">
                  <span className={radio(amount === "min")} /><span className="flex-1"><span className="block text-[15px] font-bold">Mínimo</span><span className="block text-xs text-muted-foreground">Lido na fatura do banco</span></span><strong className="tabular-nums">{money(minimum)}</strong>
                </button>
              ) : null}
              <button type="button" className={option(amount === "other")} aria-pressed={amount === "other"} onClick={() => setAmount("other")} data-testid="pay-other-button">
                <span className={radio(amount === "other")} /><span className="flex-1"><span className="block text-[15px] font-bold">Outro valor</span><span className="block text-xs text-muted-foreground">Você escolhe</span></span>
              </button>
            </div>
            {amount === "other" ? (
              <input value={other} onChange={(e) => setOther(e.target.value)} inputMode="decimal" aria-label="Outro valor" placeholder="R$ 0,00" autoFocus
                className="mt-2.5 h-[54px] w-full rounded-2xl border-2 border-primary bg-card text-center font-heading text-[22px] font-bold outline-none" data-testid="pay-value-input" />
            ) : null}
            {pay > owed ? <p className="mt-2.5 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">O valor passa do que está em aberto ({money(owed)}).</p> : null}
            {partial ? (
              <p className="mt-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" data-testid={closed ? "pay-partial-warning" : "pay-advance-note"}>
                {closed ? <>O que ficar sem pagar ({money(owed - pay)}) vai para a próxima fatura como “Saldo da fatura anterior”. O banco pode cobrar juros do rotativo, que estão entre os mais caros.</>
                  : <>A fatura ainda não fechou: este valor conta como adiantamento e {money(owed - pay)} continua em aberto.</>}
              </p>
            ) : null}

            <h3 className={section}>De qual conta sai?</h3>
            <div className="flex flex-col gap-2">
              {payers.map((a) => {
                const c = cover(a);
                const on = a.id === accountId && !c.short;
                return (
                  <button key={a.id} type="button" disabled={c.short} onClick={() => setAccountId(a.id)} aria-pressed={on} data-testid={`pay-account-${a.id}`}
                    className={cn(option(on), c.short && "cursor-not-allowed opacity-50")}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-[13px] font-heading text-[13px] font-bold text-white" style={{ background: a.type === "carteira" ? "#047857" : a.color }}>{a.type === "carteira" ? "$" : bankInitials(a.institution || a.name)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-bold">{a.name}{a.is_default ? " · Conta padrão" : ""}</span><span className="block text-xs text-muted-foreground">Saldo <span className="tabular-nums">{money(a.balance)}</span></span></span>
                    <span className="shrink-0 text-right"><span className="block text-[11px] text-muted-foreground">{c.short ? "Saldo não cobre" : c.overdraft ? "Usa cheque especial" : "Fica"}</span>
                      <strong className={cn("text-sm tabular-nums", (c.short || c.overdraft) && "text-expense")}>{money(c.after)}</strong></span>
                  </button>
                );
              })}
            </div>
            <p className="mx-1 mt-2 text-xs text-muted-foreground">A sua conta padrão vem marcada. Cada fatura pode sair de uma conta diferente.</p>

            <h3 className={section}>Quando?</h3>
            <div className="grid grid-cols-2 gap-2">
              {([["now", "Hoje"], ["due", `No vencimento, ${ddmm(invoice.due_date)}`]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setWhen(key)} aria-pressed={when === key} data-testid={`pay-when-${key}`}
                  className={cn("h-12 rounded-2xl text-[13px] font-bold", when === key ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{label}</button>
              ))}
            </div>

            <div className="mt-4 flex gap-2.5 rounded-[18px] bg-primary/[0.07] px-4 py-3.5">
              <Info className="mt-px size-[18px] shrink-0 text-primary" aria-hidden="true" />
              <span className="text-[13px] leading-snug">O pagamento sai do saldo da conta, mas <strong>não conta como gasto de novo</strong>: as compras já entraram no mês em que foram feitas.</span>
            </div>
            {overdraftMessage ? (
              <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" role="alert" data-testid="pay-overdraft-prompt">{overdraftMessage}</p>
            ) : null}
            {error ? <p className="mt-3 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive" role="alert" data-testid="pay-invoice-error">{error}</p> : null}

            <div className="mt-auto pt-5">
              <button type="button" onClick={submit} disabled={invalid || pending} data-testid={overdraftMessage ? "pay-overdraft-confirm" : "pay-confirm-button"}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-50">
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {when === "due" ? "Agendar lembrete de " : overdraftMessage ? "Usar cheque especial e pagar " : "Confirmar pagamento de "}<span className="tabular-nums">{money(pay)}</span>
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
