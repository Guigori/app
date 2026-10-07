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

/** Fluid month calendar. The bottom handle is the only expansion control: drag upward
 *  to reduce the visible weeks and downward to progressively reveal the month. */
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
  const maxMovement = Math.max(
    0,
    ...days
      .filter((day) => day.date.slice(0, 7) === month)
      .map((day) => day.income + day.expense + day.projected_income + day.projected_expense),
  );
  const heatLevel = (movement: number) => {
    if (movement <= 0 || maxMovement <= 0) return 0;
    const ratio = movement / maxMovement;
    if (ratio <= 0.2) return 1;
    if (ratio <= 0.4) return 2;
    if (ratio <= 0.65) return 3;
    if (ratio <= 0.85) return 4;
    return 5;
  };
  const heatBackground = (level: number) => {
    if (level === 0) return undefined;
    if (level === 1) return "color-mix(in srgb, var(--finnos-purple) 18%, var(--card))";
    if (level === 2) return "color-mix(in srgb, var(--finnos-purple) 34%, var(--card))";
    if (level === 3) return "color-mix(in srgb, var(--finnos-purple-live) 54%, var(--card))";
    if (level === 4) return "color-mix(in srgb, var(--finnos-violet) 76%, var(--finnos-purple))";
    return "var(--finnos-purple-live)";
  };
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
                const movement = (flow?.income ?? 0) + (flow?.expense ?? 0) + (flow?.projected_income ?? 0) + (flow?.projected_expense ?? 0);
                const level = cell.outside ? 0 : heatLevel(movement);
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
                        "relative flex h-full w-full min-h-11 items-center justify-center rounded-xl border border-border/25 text-sm font-semibold tabular-nums transition-all duration-200",
                        selected
                          ? "ring-2 ring-white/90 ring-offset-2 ring-offset-card text-white shadow-sm"
                          : cell.outside
                            ? "border-transparent bg-transparent text-muted-foreground/45"
                            : level >= 3
                              ? "text-white hover:brightness-110"
                              : "text-foreground hover:brightness-110",
                        !selected && cell.date === today ? "ring-1 ring-primary/70" : undefined,
                      )}
                      style={!cell.outside ? { backgroundColor: level > 0 ? heatBackground(level) : "color-mix(in srgb, var(--finnos-app) 14%, var(--card))" } : undefined}
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

      <div className="mt-2 flex items-center justify-end gap-1.5 px-2 text-[10px] text-muted-foreground" data-testid="calendar-heatmap-legend">
        <span>Menos</span>
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className="h-3 w-3 rounded-[4px] border border-border/20"
            style={{ backgroundColor: heatBackground(level) }}
            aria-hidden="true"
          />
        ))}
        <span>Mais</span>
      </div>

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
        onClick={() => {
          if (expanded) onToggleExpanded();
          else if (weekCount < 3) setWeekCount((value) => (value === 1 ? 2 : 3));
          else onToggleExpanded();
        }}
        whileTap={{ scaleX: 1.15 }}
        className="mx-auto mt-1 flex h-7 w-full max-w-32 cursor-grab items-center justify-center active:cursor-grabbing"
        aria-label={expanded ? "Recolher calendário" : "Mostrar mais semanas do calendário"}
        aria-expanded={expanded}
        data-testid="calendar-toggle-expanded"
      >
        <span className="h-1.5 w-12 rounded-full bg-border" aria-hidden="true" />
      </motion.button>
    </section>
  );
}
