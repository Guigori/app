import { useMemo, useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addMonth, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthSelectorProps {
  month: string;
  onChange: (month: string) => void;
}

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function MonthSelector({ month, onChange }: MonthSelectorProps) {
  const touchX = useRef<number | null>(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const years = useMemo(() => Array.from({ length: 9 }, (_, index) => year - 4 + index), [year]);

  const choose = (targetYear: number, targetMonth: number) =>
    onChange(`${targetYear}-${String(targetMonth).padStart(2, "0")}`);

  return (
    <>
      <div className="hidden items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm dashboard:inline-flex">
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-36 text-center font-heading text-sm font-semibold">{monthLabel(month)}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Popover>
        <PopoverTrigger
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted dashboard:hidden"
          aria-label={`Escolher mês. Atual: ${monthLabel(month)}`}
          data-testid="month-mobile-button"
          onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchX.current == null) return;
            const end = event.changedTouches[0]?.clientX ?? touchX.current;
            const delta = end - touchX.current;
            touchX.current = null;
            if (Math.abs(delta) < 44) return;
            event.preventDefault();
            onChange(addMonth(month, delta < 0 ? 1 : -1));
          }}
        >
          <CalendarDays className="h-4.5 w-4.5" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[18rem] rounded-3xl border-border/70 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl dashboard:hidden">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" className="rounded-full p-2 hover:bg-muted" onClick={() => choose(year - 1, monthNumber)} aria-label="Ano anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <strong className="font-heading text-base">{year}</strong>
            <button type="button" className="rounded-full p-2 hover:bg-muted" onClick={() => choose(year + 1, monthNumber)} aria-label="Próximo ano">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {MONTHS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => choose(year, index + 1)}
                className={cn(
                  "rounded-xl px-2 py-2 text-xs font-medium transition-colors",
                  index + 1 === monthNumber ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto border-t border-border/60 pt-2 [scrollbar-width:none]">
            {years.map((item) => (
              <button key={item} type="button" onClick={() => choose(item, monthNumber)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px]", item === year ? "bg-muted font-semibold" : "text-muted-foreground")}>
                {item}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Deslize na horizontal sobre o calendário para trocar de mês.</p>
        </PopoverContent>
      </Popover>
    </>
  );
}
