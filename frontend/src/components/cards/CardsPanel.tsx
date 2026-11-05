import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { CalendarClock, CreditCard as CreditCardIcon, Pencil, Repeat, Sparkles } from "lucide-react";
import { subscriptionsByCard } from "@/lib/subscriptionsView";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreditCard, SubscriptionItem } from "@/types/finnos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function usageTone(percent: number) {
  if (percent >= 90) return { bar: "bg-destructive", label: "Limite quase todo usado", badge: "destructive" as const };
  if (percent >= 70) return { bar: "bg-amber-500", label: "Perto do limite", badge: "secondary" as const };
  if (percent >= 50) return { bar: "bg-amber-400", label: "Atenção ao limite", badge: "secondary" as const };
  return { bar: "bg-income", label: "Uso tranquilo", badge: "secondary" as const };
}

/** The Cartões tab of Carteira: each card's invoice, limit, dates and the subscriptions it pays. */
export function CardsPanel({ cards, subscriptions, onCreate, onEdit }: {
  cards: CreditCard[];
  subscriptions: SubscriptionItem[];
  onCreate: () => void;
  onEdit: (card: CreditCard) => void;
}) {
  const { hidden } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const subsByCard = subscriptionsByCard(subscriptions);
  const openTotal = cards.filter((card) => card.active).reduce((sum, card) => sum + card.current_invoice, 0);
  const limitTotal = cards.filter((card) => card.active).reduce((sum, card) => sum + card.limit, 0);
  const availableTotal = cards.filter((card) => card.active).reduce((sum, card) => sum + card.available, 0);

  return (
    <div className="space-y-5" data-testid="cards-panel">
      {cards.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="cards-summary">
          <div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="text-xs text-muted-foreground">Em faturas</p><p className="mt-1 font-heading text-base font-bold tabular-nums sm:text-xl">{money(openTotal)}</p></div>
          <div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="text-xs text-muted-foreground">Disponível</p><p className="mt-1 font-heading text-base font-bold tabular-nums sm:text-xl">{money(availableTotal)}</p></div>
          <div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="text-xs text-muted-foreground">Limite total</p><p className="mt-1 font-heading text-base font-bold tabular-nums sm:text-xl">{money(limitTotal)}</p></div>
        </div>
      ) : null}
      {cards.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center"
          data-testid="cards-empty-state"
        >
          <CreditCardIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold text-foreground">Nenhum cartão cadastrado</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Cadastre seus cartões para acompanhar a fatura aberta, o limite comprometido e o melhor dia de compra.
          </p>
          <Button onClick={onCreate} data-testid="cards-empty-create-button">
            Cadastrar cartão
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" data-testid="cards-list">
          {cards.map((card, index) => {
            const tone = usageTone(card.used_percent);
            const closedPayable = Boolean(card.payable_cycle && card.payable_cycle !== card.next_closing && (card.payable_invoice ?? 0) > 0);
            return (
              <motion.article
                key={card.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 6) * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden rounded-3xl border border-border bg-card"
                data-testid={`card-item-${card.id}`}
              >
                <div className="relative p-5 text-white" style={{ background: `linear-gradient(135deg, ${card.color}, #0B1020)` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-heading text-lg font-bold" data-testid={`card-name-${card.id}`}>
                        {card.name}
                      </p>
                      <p className="text-xs text-white/70">{card.institution || "Cartão de crédito"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!card.active ? (
                        <Badge variant="secondary" className="bg-white/15 text-white">
                          Inativo
                        </Badge>
                      ) : null}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-white/80 hover:bg-white/15 hover:text-white"
                        onClick={() => onEdit(card)}
                        aria-label={`Editar ${card.name}`}
                        data-testid={`card-edit-${card.id}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  {(() => {
                    // A closed invoice past its due date is overdue: say so plainly.
                    const daysLate = closedPayable && card.payable_due && card.payable_due < todayISO()
                      ? Math.round((Date.parse(todayISO() + "T12:00:00") - Date.parse(card.payable_due + "T12:00:00")) / 86400000)
                      : 0;
                    return daysLate > 0 ? (
                      <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-[0.1em] text-expense" data-testid={`card-overdue-${card.id}`}>
                        Fatura vencida há {daysLate} {daysLate === 1 ? "dia" : "dias"}
                      </p>
                    ) : (
                      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">{closedPayable ? "Fatura fechada a pagar" : "Fatura atual"}</p>
                    );
                  })()}
                  <p className="font-heading text-3xl font-bold tabular-nums" data-testid={`card-invoice-${card.id}`}>
                    {money(closedPayable ? (card.payable_invoice ?? card.current_invoice) : card.current_invoice)}
                  </p>
                  <p className="mt-1 text-xs text-white/70">
                    {closedPayable
                      ? `Fechada em ${formatDate(card.payable_cycle!)} · vence ${card.payable_due ? formatDate(card.payable_due) : "—"}`
                      : <>Ciclo aberto desde {formatDate(card.cycle_start)}{card.invoice_paid ? " · fatura paga" : ""}</>}
                  </p>
                  <Link
                    to={`/cartoes/${card.id}`}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25"
                    data-testid={`card-invoice-link-${card.id}`}
                  >
                    Ver fatura detalhada
                  </Link>
                </div>

                <div className="space-y-4 p-5">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Limite usado</p>
                      <p className="text-sm font-semibold tabular-nums text-foreground" data-testid={`card-used-${card.id}`}>
                        {money(card.used)} / {money(card.limit)}
                      </p>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className={cn("h-full rounded-full", tone.bar)}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(card.used_percent, 100)}%` }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span data-testid={`card-usage-label-${card.id}`}>
                        {tone.label} · {Math.round(card.used_percent)}%
                      </span>
                      <span data-testid={`card-available-${card.id}`}>Disponível {money(card.available)}</span>
                    </div>
                    {card.future_installments > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground" data-testid={`card-future-${card.id}`}>
                        Inclui {money(card.future_installments)} de parcelas futuras já comprometidas.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-muted/60 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        Fechamento
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-closing-${card.id}`}>
                        {formatDate(card.next_closing)}
                      </p>
                      <p className="text-xs text-muted-foreground">Todo dia {card.closing_day}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Vencimento</p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-due-${card.id}`}>
                        {formatDate(card.next_due)}
                      </p>
                      <p className="text-xs text-muted-foreground">Todo dia {card.due_day}</p>
                    </div>
                    <div className="rounded-2xl bg-primary/8 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-primary">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        Melhor compra
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-best-day-${card.id}`}>
                        {formatDate(card.best_purchase_day)}
                      </p>
                      <p className="text-xs text-muted-foreground">Mais prazo para pagar</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Pagamento por {card.payment_account_name ?? "conta não definida"}.</span>
                    {subsByCard.get(card.id) ? (
                      <Link to="/contas?aba=assinaturas" replace className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground hover:bg-muted/70" data-testid={`card-subscriptions-${card.id}`}>
                        <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                        {subsByCard.get(card.id)!.count} {subsByCard.get(card.id)!.count === 1 ? "assinatura" : "assinaturas"} · {money(subsByCard.get(card.id)!.monthly)}/mês
                      </Link>
                    ) : null}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

    </div>
  );
}
