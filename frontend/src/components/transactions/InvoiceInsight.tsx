import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, Row } from "@/components/transactions/ReceiptParts";
import { formatBRL } from "@/lib/format";
import type { Account, CreditCard, Invoice } from "@/types/finnos";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "Pagar fatura" with the keypad closed: under the register's fields, what the payment does and the invoice itself,
 * the same way a saved lançamento shows its impact and receipt. */
export function InvoiceInsight({ invoice, card, payer, amount, hidden, today, onOpenCard }: {
  invoice: Invoice; card?: CreditCard; payer?: Account; amount: number; hidden: boolean; today: string;
  /** Leaves the register for the card's screen. */
  onOpenCard: () => void;
}) {
  const [all, setAll] = useState(false);
  const money = (v: number) => (hidden ? "R$ ••••" : `${v < 0 ? "− " : ""}${formatBRL(Math.abs(v))}`);
  const owed = Math.round((invoice.outstanding ?? invoice.total - invoice.paid_amount) * 100) / 100;
  const rest = Math.max(0, Math.round((owed - amount) * 100) / 100);
  const after = payer ? Math.round((payer.balance - amount) * 100) / 100 : null;
  const closed = invoice.cycle_end < today;
  const items = [...invoice.items].sort((a, b) => b.date.localeCompare(a.date));
  const shown = all ? items : items.slice(0, 6);
  const impact: [string, string, string?][] = [
    ...(payer && after !== null ? [[`Saldo de ${payer.name}`, `${money(payer.balance)} → ${money(after)}`, after < 0 ? "#fbbf24" : undefined] as [string, string, string?]] : []),
    [`Limite do ${card?.name ?? "cartão"}`, `+ ${money(amount)} livre`, "#34d399"],
    [rest > 0 ? "Fica para a próxima fatura" : "Esta fatura", rest > 0 ? money(rest) : "fica paga", rest > 0 ? "#fbbf24" : "#34d399"],
    ["Gastos do mês", "não mudam", undefined],
  ];
  let i = 0;
  return (
    <div className="flex flex-col gap-2.5 pb-2" data-testid="invoice-insight">
      <Card title="IMPACTO">
        {impact.map(([l, v, t], k) => <Row key={l} label={l} value={v} tone={t} i={k} last={k === impact.length - 1} />)}
      </Card>
      <p className="px-1 text-xs text-muted-foreground">As compras já entraram como gasto no mês em que foram feitas; o pagamento só tira o dinheiro da conta.</p>
      <Card title={`FATURA DE ${MONTHS[Number(invoice.cycle_end.slice(5, 7)) - 1].toUpperCase()}`}>
        <Row label={closed ? "Fechou" : "Fecha"} value={ddmm(invoice.cycle_end)} i={i++} />
        <Row label="Vence" value={ddmm(invoice.due_date)} tone={invoice.due_date < today ? "#fb7185" : undefined} i={i++} />
        <Row label="Total" value={money(invoice.total)} i={i++} />
        {invoice.paid_amount > 0 ? <Row label="Já pago" value={money(invoice.paid_amount)} tone="#34d399" i={i++} /> : null}
        <Row label="Falta pagar" value={money(owed)} i={i++} />
        {invoice.minimum_payment ? <Row label="Mínimo" value={money(invoice.minimum_payment)} i={i++} /> : null}
        <Row label="Conferida com o banco" value={invoice.reconciled ? "Sim" : "Ainda não"} tone={invoice.reconciled ? "#34d399" : undefined} i={i++} last />
      </Card>
      {items.length ? (
        <Card title={`COMPRAS NESTA FATURA · ${items.length}`}>
          {shown.map((item, k) => (
            <Row key={item.id} label={`${item.name}${item.installment_label ? ` ${item.installment_label}` : ""} · ${ddmm(item.date)}`} value={money(item.value)} i={k} last={k === shown.length - 1} />
          ))}
          {items.length > shown.length ? <button type="button" onClick={() => setAll(true)} className="w-full py-2 text-center text-sm font-semibold text-[#a78bfa]" data-testid="invoice-insight-all">Ver as {items.length}</button> : null}
        </Card>
      ) : null}
      <button type="button" onClick={onOpenCard} className="flex h-12 shrink-0 items-center justify-center gap-1 rounded-full border border-border/70 bg-card text-sm font-semibold text-[#a78bfa]" data-testid="invoice-insight-card">
        Ver análise do cartão<ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
