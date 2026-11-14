import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutList, GalleryHorizontal, Paperclip } from "lucide-react";
import { carouselOrder } from "@/lib/walletSummary";
import { cardGradient } from "@/lib/cardGradient";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { CreditCard } from "@/types/finnos";
import { cn } from "@/lib/utils";

const VIEW_KEY = "finnos:wallet-cards-view";
const readView = (): "carousel" | "list" => { try { return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "carousel"; } catch { return "carousel"; } };
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Prototype "Cartões de crédito": stacked carousel with the default card in front, dots, and the
 * selected card's limit, dates and actions underneath. A button swaps it for a plain list (v1.1). */
export function CardCarousel({ cards, hidden }: { cards: CreditCard[]; hidden: boolean }) {
  const live = cards.filter((c) => c.active);
  const [view, setViewRaw] = useState(readView);
  const setView = (next: "carousel" | "list") => { setViewRaw(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* ok */ } };
  const [picked, setPicked] = useState<number | null>(null);
  const start = Math.max(0, live.findIndex((c) => c.is_default));
  const sel = Math.min(picked ?? start, Math.max(0, live.length - 1));
  const swipe = useRef<number | null>(null);
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  if (!live.length) return null;
  const card = live[sel];
  const usedPct = card.limit ? Math.min(100, Math.round((card.used / card.limit) * 100)) : 0;

  return (
    <section aria-label="Cartões de crédito" data-testid="wallet-cards">
      <div className="mx-1 mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold">Cartões de crédito</h2>
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {view === "carousel" ? <span data-testid="wallet-carousel-pos">{sel + 1} de {live.length}</span> : null}
          <button type="button" onClick={() => setView(view === "list" ? "carousel" : "list")} aria-pressed={view === "list"}
            aria-label={view === "list" ? "Ver cartões em carrossel" : "Ver cartões em lista"} className="grid size-8 place-items-center rounded-full hover:bg-muted" data-testid="wallet-cards-view">
            {view === "list" ? <GalleryHorizontal className="size-4" /> : <LayoutList className="size-4" />}
          </button>
        </span>
      </div>

      {view === "list" ? (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card" data-testid="wallet-cards-list">
          {carouselOrder(live).map((c) => (
            <li key={c.id}>
              <Link to={`/cartoes/${encodeURIComponent(c.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50" data-testid={`carousel-card-${c.id}`}>
                <span className="h-8 w-12 shrink-0 rounded-lg" style={{ background: cardGradient(c.color) }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}{c.is_default ? " · Padrão" : ""}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.institution}{c.last_digits ? ` · final ${c.last_digits}` : ""} · vence {ddmm(c.next_due)}</span>
                </span>
                <span className="shrink-0 font-heading font-bold tabular-nums">{money(c.current_invoice)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="relative -mx-4 h-[204px] overflow-hidden sm:mx-0" aria-roledescription="carrossel" aria-label="Cartões de crédito" data-testid="wallet-carousel" data-gesture="ignore"
            onPointerDown={(e) => { swipe.current = e.clientX; }}
            onPointerUp={(e) => {
              if (swipe.current === null) return;
              const dx = e.clientX - swipe.current; swipe.current = null;
              if (Math.abs(dx) > 40) setPicked(Math.max(0, Math.min(live.length - 1, sel + (dx < 0 ? 1 : -1))));
            }}>
            {live.map((c, i) => {
              const d = i - sel;
              const far = Math.abs(d) > 1;
              const invoice = c.payable_invoice ? c.payable_invoice : c.current_invoice;
              return (
                <button key={c.id} type="button" onClick={() => setPicked(i)} aria-pressed={d === 0} tabIndex={far ? -1 : 0}
                  aria-label={`${c.name} (${c.institution}), fatura ${money(invoice)}`} data-testid={`carousel-card-${c.id}`}
                  className="absolute top-1.5 flex h-[190px] w-[300px] flex-col justify-between rounded-3xl p-5 text-left text-white transition-[left,transform,opacity] duration-300 ease-out"
                  style={{
                    left: `calc(50% - 150px + ${d * 262}px)`, background: cardGradient(c.color), zIndex: d === 0 ? 3 : 1,
                    transform: d === 0 ? "scale(1)" : "scale(0.86)", opacity: far ? 0 : d === 0 ? 1 : 0.6, pointerEvents: far ? "none" : undefined,
                    boxShadow: d === 0 ? "0 18px 36px -18px rgba(7,15,82,0.6)" : undefined,
                  }}>
                  <span className="block min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-heading text-lg font-bold">{c.name}</span>
                      {c.is_default ? <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">Padrão</span> : null}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-80">{c.institution}{c.last_digits ? ` · •••• ${c.last_digits}` : ""}</span>
                  </span>
                  <span className="block">
                    <span className="block text-xs opacity-80">{c.payable_invoice ? `Fatura fechada · vence ${ddmm(c.payable_due ?? c.next_due)}` : `Fatura aberta · fecha dia ${dayOf(c.next_closing)}`}</span>
                    <span className="mt-0.5 block font-heading text-[26px] font-bold tracking-[-0.02em] tabular-nums">{money(invoice)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex justify-center gap-1.5">
            {live.map((c, i) => (
              <button key={c.id} type="button" onClick={() => setPicked(i)} aria-label={`Mostrar ${c.name}`} className="grid size-6 place-items-center" data-testid={`wallet-carousel-dot-${i}`}>
                <span className={cn("block h-1.5 rounded-full transition-all", i === sel ? "w-5 bg-primary" : "w-1.5 bg-primary/30")} />
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-3xl border border-border bg-card p-4" data-testid="wallet-carousel-info">
            <p className="sr-only" aria-live="polite">{card.name}</p>
            <div className="flex justify-between text-[13px]"><span className="text-muted-foreground">Limite usado</span>
              <strong className="tabular-nums">{hidden ? formatHiddenBRL() : `${usedPct}% de ${formatBRL(card.limit)}`}</strong></div>
            <span className="mt-2 block h-2 overflow-hidden rounded-full bg-primary/10"><span className="block h-full rounded-full" style={{ width: `${usedPct}%`, background: card.color }} /></span>
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              <span><span className="block text-[11px] text-muted-foreground">Fecha</span><strong className="text-sm">Dia {dayOf(card.next_closing)}</strong></span>
              <span><span className="block text-[11px] text-muted-foreground">Vence</span><strong className="text-sm">{ddmm(card.next_due)}</strong></span>
              <span><span className="block text-[11px] text-muted-foreground">Melhor dia</span><strong className="text-sm">Dia {dayOf(card.best_purchase_day)}</strong></span>
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <Link to={`/cartoes/${encodeURIComponent(card.id)}?pagar=1`} className="grid h-[46px] place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground" data-testid="wallet-card-pay">Pagar fatura</Link>
              <Link to={`/cartoes/${encodeURIComponent(card.id)}`} className="grid h-[46px] place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary" data-testid="wallet-card-analysis">Ver análise</Link>
            </div>
            <Link to={`/cartoes/${encodeURIComponent(card.id)}/conferencia`} className="mt-2 flex h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-bold text-primary" data-testid="wallet-card-reconcile">
              <Paperclip className="size-4" aria-hidden="true" />Conferir com a fatura do banco
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
