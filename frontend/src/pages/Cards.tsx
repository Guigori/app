import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarClock, CreditCard as CreditCardIcon, Pencil, Plus, Sparkles } from "lucide-react";
import { fetchCards } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreditCard } from "@/types/finnos";
import { CardDialog } from "@/components/cards/CardDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function usageTone(percent: number) {
  if (percent >= 90) return { bar: "bg-destructive", label: "Limite quase todo usado", badge: "destructive" as const };
  if (percent >= 70) return { bar: "bg-amber-500", label: "Perto do limite", badge: "secondary" as const };
  return { bar: "bg-income", label: "Uso tranquilo", badge: "secondary" as const };
}

export default function Cards() {
  const [dialog, setDialog] = useState<{ open: boolean; card?: CreditCard }>({ open: false });
  const { hidden } = useBalanceHidden();
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const cards = cardsQuery.data ?? [];
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Cartões</h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="cards-subtitle">
            Fatura atual, limite usado, fechamento e melhor dia de compra.
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true })} data-testid="new-card-button">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo cartão
        </Button>
      </div>

      {cardsQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-hidden="true">
          <div className="h-60 animate-pulse rounded-3xl bg-muted" />
          <div className="h-60 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : cards.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center"
          data-testid="cards-empty-state"
        >
          <CreditCardIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold text-foreground">Nenhum cartão cadastrado</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Cadastre seus cartões para acompanhar a fatura aberta, o limite comprometido e o melhor dia de compra.
          </p>
          <Button onClick={() => setDialog({ open: true })} data-testid="cards-empty-create-button">
            Cadastrar cartão
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" data-testid="cards-list">
          {cards.map((card, index) => {
            const tone = usageTone(card.used_percent);
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
                        onClick={() => setDialog({ open: true, card })}
                        aria-label={`Editar ${card.name}`}
                        data-testid={`card-edit-${card.id}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Fatura atual</p>
                  <p className="font-heading text-3xl font-bold tabular-nums" data-testid={`card-invoice-${card.id}`}>
                    {money(card.current_invoice)}
                  </p>
                  <p className="mt-1 text-xs text-white/70">
                    Ciclo aberto desde {formatDate(card.cycle_start)}
                    {card.invoice_paid ? " · fatura paga" : ""}
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
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        Fechamento
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-closing-${card.id}`}>
                        {formatDate(card.next_closing)}
                      </p>
                      <p className="text-xs text-muted-foreground">Todo dia {card.closing_day}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/60 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Vencimento</p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-due-${card.id}`}>
                        {formatDate(card.next_due)}
                      </p>
                      <p className="text-xs text-muted-foreground">Todo dia {card.due_day}</p>
                    </div>
                    <div className="rounded-2xl bg-primary/8 p-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-primary">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        Melhor compra
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground" data-testid={`card-best-day-${card.id}`}>
                        {formatDate(card.best_purchase_day)}
                      </p>
                      <p className="text-xs text-muted-foreground">Mais prazo para pagar</p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Pagamento por {card.payment_account_name ?? "conta não definida"}.
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      <CardDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        card={dialog.card}
      />
    </div>
  );
}
