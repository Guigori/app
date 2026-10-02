import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { addMonth, monthLabel, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DayFlow } from "@/types/finnos";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const compact = (value: number) =>
  value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value));

interface TransactionCalendarProps {
  month: string;
  days: DayFlow[];
  selectedDate: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
}

/** Interactive month calendar: each day shows what entered and left, and clicking a day
 *  drives the list below it. Collapsed it keeps only the week of the selected day. */
export function TransactionCalendar({
  month,
  days,
  selectedDate,
  expanded,
  onToggleExpanded,
  onMonthChange,
  onSelectDate,
}: TransactionCalendarProps) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = todayISO();

  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const selectedWeek = weeks.find((week) => week.includes(selectedDate)) ?? weeks[0];
  const visibleWeeks = expanded ? weeks : [selectedWeek];

  return (
    <div className="rounded-3xl border border-border bg-card p-4" data-testid="transaction-calendar">
      <div className="flex items-center justify-between gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMonthChange(addMonth(month, -1))}
          aria-label="Mês anterior"
          data-testid="calendar-prev-month"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <p className="font-heading text-sm font-semibold text-foreground" data-testid="calendar-month-label">
          {monthLabel(month)}
        </p>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onMonthChange(addMonth(month, 1))}
            aria-label="Próximo mês"
            data-testid="calendar-next-month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onToggleExpanded}
            aria-label={expanded ? "Recolher calendário" : "Expandir calendário"}
            aria-expanded={expanded}
            data-testid="calendar-toggle-expanded"
          >
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="mt-1 space-y-1">
        {visibleWeeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-1">
            {week.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} aria-hidden="true" />;
              const flow = byDate.get(date);
              const income = (flow?.income ?? 0) + (flow?.projected_income ?? 0);
              const expense = (flow?.expense ?? 0) + (flow?.projected_expense ?? 0);
              const selected = date === selectedDate;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelectDate(date)}
                  aria-label={`Ver transações de ${date}`}
                  aria-current={selected ? "date" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors duration-150",
                    selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    !selected && date === today ? "ring-1 ring-primary/50" : undefined,
                  )}
                  data-testid={`calendar-day-${date}`}
                >
                  <span className={cn("text-sm font-semibold tabular-nums", selected ? "" : "text-foreground")}>
                    {Number(date.slice(8, 10))}
                  </span>
                  {income > 0 ? (
                    <span className={cn("text-[10px] font-medium tabular-nums", selected ? "" : "text-income")}>
                      +{compact(income)}
                    </span>
                  ) : null}
                  {expense > 0 ? (
                    <span className={cn("text-[10px] font-medium tabular-nums", selected ? "" : "text-expense")}>
                      −{compact(expense)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
