import { useMemo } from "react";
import { formatBRL } from "@/lib/format";
import type { DayFlow } from "@/types/finnos";

interface FinancialHeatmapCalendarProps {
  month: string;
  days: DayFlow[];
  hidden?: boolean;
}

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

export function FinancialHeatmapCalendar({ month, days, hidden = false }: FinancialHeatmapCalendarProps) {
  const { cells, maxMovement } = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const count = new Date(year, monthNumber, 0).getDate();
    const offset = new Date(year, monthNumber - 1, 1).getDay();
    const byDate = new Map(days.map((day) => [day.date, day]));
    const items = Array.from({ length: count }, (_, index) => {
      const dayNumber = index + 1;
      const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
      const day = byDate.get(date);
      const movement = (day?.income ?? 0) + (day?.expense ?? 0);
      return { dayNumber, date, day, movement };
    });
    return {
      cells: [...Array.from({ length: offset }, () => null), ...items],
      maxMovement: Math.max(0, ...items.map((item) => item.movement)),
    };
  }, [days, month]);

  const intensity = (movement: number) => {
    if (movement <= 0 || maxMovement <= 0) return 0;
    const ratio = movement / maxMovement;
    if (ratio <= 0.2) return 1;
    if (ratio <= 0.4) return 2;
    if (ratio <= 0.65) return 3;
    if (ratio <= 0.85) return 4;
    return 5;
  };

  const backgroundFor = (level: number) => {
    if (level === 0) return "var(--muted)";
    if (level === 1) return "color-mix(in srgb, var(--finnos-purple) 20%, var(--background))";
    if (level === 2) return "color-mix(in srgb, var(--finnos-purple) 38%, var(--background))";
    if (level === 3) return "color-mix(in srgb, var(--finnos-purple-live) 58%, var(--background))";
    if (level === 4) return "color-mix(in srgb, var(--finnos-violet) 78%, var(--finnos-purple))";
    return "var(--finnos-purple-live)";
  };

  return (
    <div data-testid="flow-heatmap-calendar">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted-foreground">
        {WEEKDAYS.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {cells.map((cell, index) => {
          if (!cell) return <span key={`empty-${index}`} className="aspect-square" aria-hidden="true" />;
          const level = intensity(cell.movement);
          const label = cell.movement > 0
            ? `Dia ${cell.dayNumber}: ${hidden ? "valor oculto" : formatBRL(cell.movement)} em movimentações`
            : `Dia ${cell.dayNumber}: sem movimentação`;
          return (
            <div
              key={cell.date}
              className="flex aspect-square min-h-9 items-center justify-center rounded-lg border border-border/30 text-xs font-semibold transition-transform hover:scale-[1.03] sm:min-h-11"
              style={{
                backgroundColor: backgroundFor(level),
                color: level >= 3 ? "#FFFFFF" : "var(--foreground)",
              }}
              title={label}
              aria-label={label}
            >
              {cell.dayNumber}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        <span>Menos</span>
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className="h-3.5 w-3.5 rounded-[4px] border border-border/20"
            style={{ backgroundColor: backgroundFor(level) }}
            aria-hidden="true"
          />
        ))}
        <span>Mais</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Quanto mais roxo, maior foi a movimentação financeira do dia.</p>
    </div>
  );
}
