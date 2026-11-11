import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, CreditCard as CardIcon } from "lucide-react";
import { fetchInvoice } from "@/lib/data";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { closingForMonth, invoiceMonths, invoicePoint, mergeInvoicePoints, overdueFinding, readInvoices, type InvoicePoint } from "@/lib/insights/invoices";
import { cn } from "@/lib/utils";
import type { CreditCard } from "@/types/finnos";
import { BigMoney, FindingList, InsightShell, Tile } from "@/components/insights/InsightShell";
import { FINNOS_COLOR, ProjectionLine } from "@/components/charts/FinnosCharts";
import type { WidgetSize } from "@/lib/insights/registry";

const SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const short = (month: string) => SHORT[Number(month.slice(5, 7)) - 1] ?? month;
const dm = (date: string) => date.split("-").reverse().slice(0, 2).join("/");

/** Analysis library · Faturas: last, current and next invoices of one card, or of every active card together. */
export function InvoicesInsight({ cards, cardId = null, compact: compactProp = false, size, to, className }: { cards: CreditCard[]; cardId?: string | null; compact?: boolean; size?: WidgetSize; to?: string; className?: string }) {
  const compact = size ? size !== "XL" : compactProp;
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const scope = useMemo(() => cards.filter((c) => (cardId ? c.id === cardId : c.active)), [cards, cardId]);
  const card = cardId ? scope[0] ?? null : null;
  const plan = scope.flatMap((c) => invoiceMonths(c).map(({ offset, month }) => ({ card: c, offset, cycle: closingForMonth(c, month) })));
  const results = useQueries({
    queries: plan.map((p) => ({
      queryKey: ["invoice", p.card.id, p.cycle],
      queryFn: () => fetchInvoice(p.card.id, p.cycle),
      staleTime: 60_000,
    })),
  });
  const pending = results.some((r) => r.isPending);
  const { points, perCard } = useMemo(() => {
    const perCard = scope.map((c) => plan
      .map((p, i) => ({ p, r: results[i] }))
      .filter(({ p, r }) => p.card.id === c.id && r.data)
      .map(({ p, r }) => invoicePoint(p.offset, r.data!)));
    return { points: mergeInvoicePoints(perCard), perCard };
    // results changes identity each render; the data inside is what matters.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, results.map((r) => r.dataUpdatedAt).join(",")]);
  const today = todayISO();
  // Several cards close on different days: name positions (passada, atual…) instead of months, and say each overdue invoice per card.
  const single = scope.length === 1;
  const reading = readInvoices(points, money, today, { overdue: false, labels: single });
  const overdue = scope.map((c, i) => overdueFinding(single ? null : c.name, perCard[i]?.find((p) => p.offset === -1), money, today)).filter((f) => f !== null);
  const findings = [...overdue, ...reading.findings];

  if (!scope.length) return null;
  if (pending && !points.length) return <div className={cn("h-full min-h-40 animate-pulse rounded-[24px] bg-muted", className)} aria-label="Carregando faturas" />;
  const vs = reading.change != null && reading.past && reading.past.total > 0
    ? <span className={reading.change > 0 ? "text-expense" : "text-income"}>{reading.change > 0 ? "+" : "−"}{money(Math.abs(reading.change))} vs {single ? short(reading.past.month).toLowerCase() : "a passada"}</span> : null;
  const tileTitle = card ? `Fatura ${card.name}` : "Faturas";
  if (size === "S") return (
    <Tile title={tileTitle} icon={<CardIcon className="size-3.5" />} className={className} testId="invoices-insight">
      <p className="font-heading text-[clamp(1.15rem,6vw,1.625rem)] font-bold tabular-nums leading-none">{money(reading.present?.total ?? 0)}</p>
      <p className="mt-auto text-xs text-muted-foreground">{vs ?? "fatura atual"}</p>
    </Tile>
  );
  if (size === "M") return (
    <Tile title={tileTitle} icon={<CardIcon className="size-3.5" />} className={className} testId="invoices-insight">
      <div className="flex items-baseline justify-between gap-2"><p className="font-heading text-[22px] font-bold tabular-nums leading-none">{money(reading.present?.total ?? 0)}</p><span className="text-xs">{vs}</span></div>
      {hidden ? null : <div className="mt-auto"><ProjectionLine points={points.map((p) => ({ value: p.total, kind: p.offset > 0 ? "previsto" as const : "real" as const }))} height={56} labels={false} ariaLabel="Fatura passada, atual e próximas" /></div>}
    </Tile>
  );

  const peak = Math.max(1, ...points.map((p) => p.total));
  const POSITION: Record<number, string> = { [-1]: "Passada", 0: "Atual", 1: "Próxima", 2: "Depois" };
  const label = (p: InvoicePoint) => !single ? POSITION[p.offset] ?? short(p.month) : p.offset === 0 ? `${short(p.month)} · atual` : p.offset < 0 ? `${short(p.month)}${p.paid ? " · paga" : ""}` : short(p.month);
  // Dots of the little line: higher invoice, higher dot.
  const y = (p: InvoicePoint) => 8 + (1 - p.total / peak) * 44;
  const x = (i: number) => ((i + 0.5) * 400) / Math.max(points.length, 1);

  return (
    <InsightShell
      to={to}
      className={className}
      testId={cardId ? `invoices-insight-${cardId}` : "invoices-insight"}
      title="Faturas"
      subtitle={card ? `${card.name} · passada, atual e próximas` : `${scope.length === 1 ? scope[0].name : `Todos os ${scope.length} cartões`} · passada, atual e próximas`}
      icon={<CardIcon className="size-5" aria-hidden="true" />}
    >
      <BigMoney value={reading.present?.total ?? 0} hidden={hidden} />
      <p className="mt-1 text-xs text-muted-foreground">
        {card && reading.present?.dueDate ? `Fatura atual · fecha ${dm(card.next_closing)} · vence ${dm(reading.present.dueDate)}` : "Soma das faturas atuais"}
        {reading.change != null && reading.past && reading.past.total > 0 ? <> · <span className={reading.change > 0 ? "text-expense" : "text-income"}>{reading.change > 0 ? "+" : "−"}{money(Math.abs(reading.change))} vs {single ? short(reading.past.month).toLowerCase() : "a passada"}</span></> : null}
      </p>

      <div className="relative mt-4 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))` }} data-testid="invoices-timeline">
        <svg className="pointer-events-none absolute inset-x-0 top-1 h-[60px] w-full" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
          {/* Linha de projeção: what already closed or is open in a solid line, the next invoices dashed in the forecast colour. */}
          <polyline fill="none" stroke={FINNOS_COLOR.result} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            points={points.map((p, i) => ({ p, i })).filter(({ p }) => p.offset <= 0).map(({ p, i }) => `${x(i)},${y(p)}`).join(" ")} />
          <polyline fill="none" stroke={FINNOS_COLOR.forecast} strokeDasharray="6 6" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            points={points.map((p, i) => ({ p, i })).filter(({ p }) => p.offset >= 0).map(({ p, i }) => `${x(i)},${y(p)}`).join(" ")} />
        </svg>
        {points.map((p) => {
          const tile = (
            <div className={cn("relative flex h-full flex-col items-center rounded-2xl border px-1 pb-2.5 pt-1", p.offset === 0 ? "border-primary/60 bg-primary/8" : "border-transparent")}>
              <div className="relative h-[60px] w-full">
                <span className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ top: y(p), borderColor: p.offset > 0 ? FINNOS_COLOR.forecast : FINNOS_COLOR.result, backgroundColor: p.offset > 0 ? "var(--card)" : FINNOS_COLOR.result }} />
              </div>
              <span className={cn("text-[11px]", p.offset === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{label(p)}</span>
              <span className="mt-0.5 text-xs font-semibold tabular-nums">{money(p.total)}</span>
            </div>
          );
          return card ? <Link key={p.offset} to={`/cartoes/${card.id}`} aria-label={`Fatura de ${short(p.month)}: ${money(p.total)}`}>{tile}</Link> : <div key={p.offset}>{tile}</div>;
        })}
      </div>

      <div className="mt-4">
        <FindingList findings={compact ? findings.slice(0, 2) : findings} testId="invoices-findings" />
      </div>

      {!compact && reading.biggest ? (
        <p className="mt-3 text-xs text-muted-foreground">Maior compra da fatura atual: <span className="font-semibold text-foreground">{reading.biggest.name}</span> · {money(reading.biggest.value)}{reading.biggest.installment_label ? ` · parcela ${reading.biggest.installment_label}` : ""}</p>
      ) : null}
      {card ? (
        <Link to={`/cartoes/${card.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Ver fatura detalhada <ChevronRight className="size-4" /></Link>
      ) : compact ? (
        <Link to="/contas?aba=cartoes" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Ver cartões <ChevronRight className="size-4" /></Link>
      ) : null}
    </InsightShell>
  );
}
