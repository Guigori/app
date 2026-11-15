/** Calendário and Movimentações recentes as widgets of the painel (Início on the computer starts with them). */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { fetchDashboard } from "@/lib/data";
import { currentMonth, formatBRL, formatDate, formatHiddenBRL, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";
import { HEAT } from "@/components/charts/FinnosCharts";
import { TransactionCalendar } from "@/components/transactions/TransactionCalendar";
import { InsightShell, NOTE, Tile } from "@/components/insights/InsightShell";
import { useCalendar } from "@/components/insights/useInsightData";
import type { WidgetSize } from "@/lib/insights/registry";

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];

export function CalendarWidget({ size, className }: { size: WidgetSize; className?: string }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth);
  const calendar = useCalendar(month);
  const today = todayISO();
  if (!calendar.data) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  const days = calendar.data.days;
  const open = (date: string) => navigate(`/transacoes?date=${date}`);
  if (size === "M") {
    // The week around today, in the same heat scale as the month.
    const base = new Date(`${today}T12:00:00`);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() - base.getDay() + i);
      return d.toLocaleDateString("en-CA");
    });
    const byDate = new Map(days.map((d) => [d.date, d]));
    const move = (date: string) => { const f = byDate.get(date); return f ? f.income + f.expense + f.projected_income + f.projected_expense : 0; };
    const max = Math.max(0, ...week.map(move));
    const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
    return (
      <Tile title="Esta semana" className={className} testId="calendar-widget">
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {week.map((date, i) => {
            const lv = level(move(date));
            return (
              <button key={date} type="button" onClick={() => open(date)} aria-label={`Ver lançamentos de ${date}`}
                className={cn("flex flex-col items-center justify-center gap-1 rounded-xl border text-[13px] font-semibold tabular-nums", lv ? "border-transparent" : "border-border/70", lv >= 4 && "text-white", date === today && "ring-2 ring-primary ring-offset-2 ring-offset-card")}
                style={lv ? { backgroundColor: HEAT[lv] } : undefined}>
                <span className={cn("text-[10px] font-semibold", lv >= 4 ? "text-white/80" : "text-muted-foreground")}>{WEEK[i]}</span>
                {Number(date.slice(8))}
              </button>
            );
          })}
        </div>
      </Tile>
    );
  }
  return (
    <TransactionCalendar compact className={cn("h-full rounded-3xl", className)} month={month} days={days}
      selectedDate={month === today.slice(0, 7) ? today : `${month}-01`} expanded onToggleExpanded={() => undefined}
      onMonthChange={setMonth} onSelectDate={open} />
  );
}

export function RecentWidget({ size, to, className }: { size: WidgetSize; to?: string; className?: string }) {
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const month = currentMonth();
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month), staleTime: 60_000 });
  if (!dashboard.data) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  const recent = dashboard.data.recent;
  const row = (tx: (typeof recent)[number], dense = false) => {
    const out = tx.type === "despesa";
    const Icon = out ? ArrowUpRight : ArrowDownLeft;
    return (
      <Link key={tx.id} to={`/transacoes?date=${tx.date}&highlight=${tx.id}`} className={cn("-mx-2 flex items-center gap-3 rounded-xl px-2 hover:bg-muted/60", dense ? "py-1.5" : "py-2.5")}>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", out ? "bg-expense/10 text-expense" : "bg-income/10 text-income")}><Icon className="size-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{tx.name}</span><span className="block truncate text-xs text-muted-foreground">{formatDate(tx.date)} · {tx.category_name ?? tx.type}</span></span>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", out ? "text-expense" : "text-income")}>{out ? "−" : "+"}{money(tx.value)}</span>
      </Link>
    );
  };
  if (!recent.length) return (
    <Tile title="Movimentações recentes" className={className} testId="recent-widget">
      <p className={cn(NOTE, "mt-auto")}>Ainda não há movimentações neste mês.</p>
    </Tile>
  );
  if (size === "S") {
    const last = recent[0];
    return (
      <Tile title="Última movimentação" className={className} testId="recent-widget">
        <p className="truncate font-heading text-lg font-semibold">{last.name}</p>
        <p className={cn("mt-auto text-base font-bold tabular-nums", last.type === "despesa" ? "text-expense" : "text-income")}>{last.type === "despesa" ? "−" : "+"}{money(last.value)}</p>
        <p className={NOTE}>{formatDate(last.date)}</p>
      </Tile>
    );
  }
  if (size === "M") return (
    <Tile title="Movimentações recentes" className={className} testId="recent-widget">
      <div className="-mt-1 divide-y divide-border/60">{recent.slice(0, 3).map((tx) => row(tx, true))}</div>
    </Tile>
  );
  return (
    <InsightShell title="Movimentações recentes" subtitle={`${recent.length} mais recentes do mês`} to={to} className={cn("h-full", className)} testId="recent-widget">
      <div className="-mt-2 divide-y divide-border/60">{recent.slice(0, 6).map((tx) => row(tx))}</div>
    </InsightShell>
  );
}
