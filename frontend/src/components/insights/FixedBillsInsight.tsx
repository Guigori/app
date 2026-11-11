import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, Check, ChevronRight } from "lucide-react";
import { fetchTransactions, settleTransaction } from "@/lib/data";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { readFixedBills, type FixedBillState } from "@/lib/insights/fixedBills";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { BigMoney, InsightShell, Tile } from "@/components/insights/InsightShell";
import { FINNOS_COLOR, SegmentedBar } from "@/components/charts/FinnosCharts";
import type { WidgetSize } from "@/lib/insights/registry";

type Filter = "todas" | "pagas" | "apagar";
const dm = (date: string) => date.split("-").reverse().slice(0, 2).join("/");

/** Analysis library · Contas fixas: in a period, what was paid and what is still to pay (tap the circle to pay). */
export function FixedBillsInsight({ start, end, title = "Contas fixas", periodLabel = "neste mês", compact: compactProp = false, size, to, flowLink, className }: {
  start: string; end: string; title?: string; periodLabel?: string; compact?: boolean; size?: WidgetSize; to?: string; flowLink?: string; className?: string;
}) {
  const compact = size ? size !== "XL" : compactProp;
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("todas");
  const [day, setDay] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["transactions", "fixed-bills", start, end], queryFn: () => fetchTransactions({ start_date: start, end_date: end, type: "despesa" }), staleTime: 30_000 });
  const today = todayISO();

  if (query.isPending) return <div className={cn("h-48 animate-pulse rounded-[24px] bg-muted", className)} aria-label="Carregando contas fixas" />;
  const r = readFixedBills(query.data ?? [], start, end, today);
  if (compact && !r.bills.length && !size) return null;
  const late = r.bills.filter((b) => b.state === "atrasado").reduce((s2, b) => s2 + b.value, 0);
  // Barra segmentada: paid (income), still to pay (forecast, striped) and late (expense).
  const bar = <SegmentedBar segments={[{ value: r.paidTotal, color: FINNOS_COLOR.income, label: "Pagas" }, { value: late, color: FINNOS_COLOR.expense, label: "Atrasadas" }, { value: Math.max(0, r.dueTotal - late), color: FINNOS_COLOR.forecast, striped: true, label: "A pagar" }]} total={r.total} height={8} />;
  if (size === "S" || size === "M") return (
    <Tile title="Contas fixas" icon={<CalendarCheck className="size-3.5" />} className={className} testId="fixed-bills-insight">
      <p className="font-heading text-[22px] font-bold tabular-nums leading-none">{r.paidCount} de {r.bills.length} <span className="text-sm font-semibold text-muted-foreground">pagas</span></p>
      <p className="mt-1 text-xs text-muted-foreground">{r.dueTotal > 0 ? <>falta <b className="text-foreground">{money(r.dueTotal)}</b></> : r.bills.length ? "tudo pago" : "nenhuma no mês"}{r.lateCount ? <span className="font-semibold text-expense"> · {r.lateCount} atrasada{r.lateCount > 1 ? "s" : ""}</span> : null}</p>
      <div className="mt-2">{bar}</div>
      {size === "M" ? (
        <ul className="mt-auto space-y-0.5 text-xs">
          {r.bills.filter((b) => b.state !== "pago").slice(0, 2).map((b) => <li key={b.tx.id} className="flex justify-between gap-2"><span className={cn("min-w-0 truncate", b.state === "atrasado" && "text-expense")}>{b.tx.name} · {b.state === "atrasado" ? "venceu" : "vence"} {dm(b.tx.date)}</span><span className="shrink-0 tabular-nums">{money(b.value)}</span></li>)}
        </ul>
      ) : null}
    </Tile>
  );
  const shown = r.bills
    .filter((b) => filter === "todas" || (filter === "pagas" ? b.state === "pago" : b.state !== "pago"))
    .filter((b) => !day || b.tx.date === day);
  const list = (compact ? shown.slice(0, size === "L" ? 6 : 5) : shown);

  const pay = async (id: string) => {
    const bill = r.bills.find((b) => b.tx.id === id);
    if (!bill || paying) return;
    setPaying(id);
    try {
      await settleTransaction(bill.tx);
      await Promise.all(["transactions", "accounts", "dashboard", "cards", "calendar", "budget"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(`${bill.tx.name} marcada como paga.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível marcar agora."); } finally { setPaying(null); }
  };
  const stateText = (state: FixedBillState, date: string, where: string) =>
    state === "pago" ? `pago · ${dm(date)}${where ? ` · ${where}` : ""}` : state === "atrasado" ? `venceu ${dm(date)}${where ? ` · ${where}` : ""}` : `vence ${dm(date)}${where ? ` · ${where}` : ""}`;

  return (
    <InsightShell
      className={className}
      testId="fixed-bills-insight"
      to={to}
      title={title}
      subtitle={`${r.bills.length} ${r.bills.length === 1 ? "conta" : "contas"} ${periodLabel}`}
      icon={<CalendarCheck className="size-5" aria-hidden="true" />}
    >
      {r.bills.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta fixa {periodLabel}.</p> : (
        <>
          <BigMoney value={r.total} hidden={hidden} />
          <p className="mt-1 text-xs text-muted-foreground" data-testid="fixed-bills-progress">
            {r.paidCount} de {r.bills.length} pagas{r.dueTotal > 0 ? <> · falta <b className="text-foreground">{money(r.dueTotal)}</b></> : " · tudo pago"}
            {r.lateCount ? <> · <span className="font-semibold text-expense">{r.lateCount} {r.lateCount === 1 ? "atrasada" : "atrasadas"}</span></> : null}
          </p>
          <div className="mt-2">{bar}</div>

          {r.days.length > 1 ? (
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Dias de vencimento">
              {r.days.map((d) => (
                <button key={d.date} type="button" onClick={() => setDay((v) => (v === d.date ? null : d.date))} aria-pressed={day === d.date}
                  className={cn("flex min-w-12 shrink-0 flex-col items-center rounded-2xl border px-2.5 py-1.5", day === d.date ? "border-primary bg-primary/10" : "border-border")}>
                  <span className="text-sm font-bold tabular-nums">{d.date.slice(8, 10)}</span>
                  <span className="flex gap-0.5">{Array.from({ length: Math.min(d.count, 4) }, (_, i) => <span key={i} className={cn("size-1 rounded-full", i < d.paid ? "bg-income" : d.date < today ? "bg-expense" : "bg-muted-foreground")} />)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {!compact ? (
            <div className="mt-3 flex gap-1 rounded-full border border-border bg-muted/50 p-1" role="group" aria-label="Filtrar contas fixas">
              {([["todas", "Todas"], ["pagas", `Pagas · ${r.paidCount}`], ["apagar", `A pagar · ${r.bills.length - r.paidCount}`]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} data-testid={`fixed-bills-filter-${k}`}
                  className={cn("flex-1 rounded-full px-2 py-1.5 text-xs font-semibold", filter === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
          ) : null}

          <ul className="mt-2 divide-y divide-border/70" data-testid="fixed-bills-list">
            {list.map((b) => (
              <li key={b.tx.id} className="flex items-center gap-3 py-2.5">
                <button type="button" disabled={b.state === "pago" || paying === b.tx.id} onClick={() => void pay(b.tx.id)}
                  aria-label={b.state === "pago" ? `${b.tx.name} já paga` : `Marcar ${b.tx.name} como paga`}
                  className={cn("grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors", b.state === "pago" ? "border-income bg-income text-white" : b.state === "atrasado" ? "border-expense/70" : "border-border hover:border-primary", paying === b.tx.id && "animate-pulse")}>
                  {b.state === "pago" ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : null}
                </button>
                <button type="button" onClick={() => dialogs.openTransactionDetail(b.tx, r.bills.map((x) => x.tx))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", b.state === "pago" && "text-muted-foreground line-through")}>{b.tx.name}</span>
                    <span className={cn("block text-xs", b.state === "atrasado" ? "text-expense" : "text-muted-foreground")}>{stateText(b.state, b.tx.date, b.tx.card_name ?? b.tx.account_name ?? "")}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(b.value)}</span>
                </button>
              </li>
            ))}
            {!list.length ? <li className="py-3 text-sm text-muted-foreground">Nada aqui com esse filtro.</li> : null}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Toque no círculo para marcar como paga.</p>
          {compact && (shown.length > list.length || flowLink) ? (
            <Link to={flowLink ?? "/transacoes"} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary">Ver todas no Fluxo <ChevronRight className="size-4" /></Link>
          ) : null}
        </>
      )}
    </InsightShell>
  );
}
