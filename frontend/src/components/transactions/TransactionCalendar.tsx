import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { addMonth, monthLabel, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DayFlow } from "@/types/finnos";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

interface Cell {
  date: string;
  outside: boolean;
}

function buildCells(month: string): Cell[] {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date: iso, outside: iso.slice(0, 7) !== month };
  });
}

interface TransactionCalendarProps {
  month: string;
  days: DayFlow[];
  selectedDate: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
}

/** Month calendar: clean day numbers with entrada/saída dots, a selected day pill and a
 *  drag handle that expands or collapses the grid to the current week. */
export function TransactionCalendar({
  month,
  days,
  selectedDate,
  expanded,
  onToggleExpanded,
  onMonthChange,
  onSelectDate,
}: TransactionCalendarProps) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = todayISO();
  const cells = buildCells(month);
  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const trimmed = weeks.filter((week) => week.some((cell) => !cell.outside));
  const selectedWeek = trimmed.find((week) => week.some((cell) => cell.date === selectedDate)) ?? trimmed[0];
  const [weekCount, setWeekCount] = useState<1 | 2 | 3>(1);
  const selectedWeekIndex = Math.max(0, trimmed.findIndex((week) => week.some((cell) => cell.date === selectedDate)));
  const compactStart = Math.min(Math.max(0, selectedWeekIndex - Math.floor((weekCount - 1) / 2)), Math.max(0, trimmed.length - weekCount));
  const visibleWeeks = expanded ? trimmed : trimmed.slice(compactStart, compactStart + weekCount);

  return (
    <section className="rounded-3xl border border-border bg-card px-3 pb-2 pt-4" data-testid="transaction-calendar">
      <div className="flex items-center justify-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMonthChange(addMonth(month, -1))}
          aria-label="Mês anterior"
          data-testid="calendar-prev-month"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2 className="min-w-44 text-center font-heading text-lg font-bold capitalize text-foreground" data-testid="calendar-month-label">
          {monthLabel(month)}
        </h2>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMonthChange(addMonth(month, 1))}
          aria-label="Próximo mês"
          data-testid="calendar-next-month"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="mt-3 flex justify-center gap-1" role="group" aria-label="Quantidade de semanas visíveis">
        {([1, 2, 3] as const).map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => {
              setWeekCount(count);
              if (expanded) onToggleExpanded();
            }}
            className={cn(
              "h-7 min-w-7 rounded-full px-2 text-xs font-semibold transition-colors",
              !expanded && weekCount === count ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            aria-pressed={!expanded && weekCount === count}
          >
            {count}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { if (!expanded) onToggleExpanded(); }}
          className={cn("h-7 rounded-full px-3 text-xs font-semibold transition-colors", expanded ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          aria-pressed={expanded}
        >
          Mês
        </button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`${month}-${expanded ? "full" : `weeks-${weekCount}`}`}
          initial={{ opacity: 0, y: expanded ? -6 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="mt-1"
        >
          {visibleWeeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7">
              {week.map((cell) => {
                const flow = byDate.get(cell.date);
                const hasIncome = (flow?.income ?? 0) + (flow?.projected_income ?? 0) > 0;
                const hasExpense = (flow?.expense ?? 0) + (flow?.projected_expense ?? 0) > 0;
                const selected = cell.date === selectedDate;
                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => onSelectDate(cell.date)}
                    aria-label={`Ver lançamentos de ${cell.date}`}
                    aria-current={selected ? "date" : undefined}
                    className="flex flex-col items-center gap-1 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    data-testid={`calendar-day-${cell.date}`}
                  >
                    <span
                      className={cn(
                        "relative flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors duration-200",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : cell.outside
                            ? "text-muted-foreground/45"
                            : "text-foreground hover:bg-muted",
                        !selected && cell.date === today ? "ring-1 ring-primary/60" : undefined,
                      )}
                    >
                      {Number(cell.date.slice(8, 10))}
                    </span>
                    <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                      {hasIncome ? <span className="h-1.5 w-1.5 rounded-full bg-income" /> : null}
                      {hasExpense ? <span className="h-1.5 w-1.5 rounded-full bg-expense" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Drag the handle up to collapse to the week, down to show the whole month. */}
      <motion.button
        type="button"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.25}
        onDragEnd={(_, info) => {
          if (info.offset.y < -18) {
            if (expanded) onToggleExpanded();
            else setWeekCount((value) => (value === 3 ? 2 : 1));
          }
          if (info.offset.y > 18) {
            if (!expanded && weekCount < 3) setWeekCount((value) => (value === 1 ? 2 : 3));
            else if (!expanded) onToggleExpanded();
          }
        }}
        onClick={onToggleExpanded}
        whileTap={{ scaleX: 1.15 }}
        className="mx-auto mt-1 flex h-7 w-full max-w-32 cursor-grab items-center justify-center active:cursor-grabbing"
        aria-label={expanded ? "Recolher calendário para a semana" : "Expandir calendário para o mês"}
        aria-expanded={expanded}
        data-testid="calendar-toggle-expanded"
      >
        <span className="h-1.5 w-12 rounded-full bg-border" aria-hidden="true" />
      </motion.button>
    </section>
  );
}
