import { Link } from "react-router-dom";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { UpcomingInvoice } from "@/lib/walletSummary";
import { cn } from "@/lib/utils";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Prototype "Próximas faturas": the due day, the card and a "Pagar" button. */
export function UpcomingInvoices({ invoices, hidden, limit = 4 }: { invoices: UpcomingInvoice[]; hidden: boolean; limit?: number }) {
  if (!invoices.length) return null;
  const money = (cents: number) => (hidden ? formatHiddenBRL() : formatBRL(cents / 100));
  return (
    <section aria-label="Próximas faturas" data-testid="wallet-upcoming-invoices">
      <h2 className="mx-1 mb-3 font-heading text-lg font-bold">Próximas faturas</h2>
      <div className="rounded-3xl border border-border bg-card px-4 py-1.5">
        {invoices.slice(0, limit).map((inv, i) => (
          <div key={`${inv.cardId}:${inv.state}`} className={cn("flex items-center gap-3.5 py-3", i > 0 && "border-t border-border/60")}>
            <span className="w-[46px] shrink-0 text-center">
              <span className={cn("block font-heading text-lg font-bold", inv.state === "overdue" && "text-expense")}>{Number(inv.due.slice(8, 10))}</span>
              <span className="block text-[11px] text-muted-foreground">{MONTHS[Number(inv.due.slice(5, 7)) - 1]}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{inv.cardName}{inv.state === "overdue" ? <span className="ml-1.5 text-xs font-bold text-expense">vencida</span> : inv.state === "open" ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">aberta</span> : null}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">{money(inv.amountCents)}</span>
            </span>
            <Link to={`/cartoes/${encodeURIComponent(inv.cardId)}?pagar=1`} className="grid h-[38px] place-items-center rounded-full bg-primary/10 px-4 text-[13px] font-bold text-primary"
              data-testid={`wallet-invoice-pay-${inv.cardId}`}>Pagar</Link>
          </div>
        ))}
      </div>
    </section>
  );
}
