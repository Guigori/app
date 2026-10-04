import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addMonth, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthSelectorProps {
  month: string;
  onChange: (month: string) => void;
  visibilityControl?: React.ReactNode;
}

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function MonthSelector({ month, onChange, visibilityControl }: MonthSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const shownYear = pickerYear ?? year;
  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => shownYear - 3 + i), [shownYear]);

  const choose = (targetYear: number, targetMonth: number) => {
    onChange(`${targetYear}-${String(targetMonth).padStart(2, "0")}`);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <div className="flex items-center rounded-full border border-border bg-card p-1 shadow-sm">
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <PopoverTrigger className="flex min-w-28 items-center justify-center gap-2 rounded-md px-2 py-1.5 font-heading text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-w-36" aria-label={`Escolher mês. Atual: ${monthLabel(month)}`}>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {monthLabel(month)}
          </PopoverTrigger>
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <PopoverContent align="end" className="w-[18rem] rounded-3xl border-border/70 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" className="rounded-full p-2 hover:bg-muted" onClick={() => setPickerYear(shownYear - 1)}><ChevronLeft className="h-4 w-4" /></button>
            <strong className="font-heading text-base">{shownYear}</strong>
            <button type="button" className="rounded-full p-2 hover:bg-muted" onClick={() => setPickerYear(shownYear + 1)}><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {MONTHS.map((label, index) => (
              <button key={label} type="button" onClick={() => choose(shownYear, index + 1)} className={cn("rounded-xl px-2 py-2 text-xs font-medium transition-colors", index + 1 === monthNumber && shownYear === year ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{label}</button>
            ))}
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto border-t border-border/60 pt-2 [scrollbar-width:none]">
            {years.map((item) => <button key={item} type="button" onClick={() => setPickerYear(item)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px]", item === shownYear ? "bg-muted font-semibold" : "text-muted-foreground")}>{item}</button>)}
          </div>
        </PopoverContent>
      </Popover>
      {visibilityControl}
    </div>
  );
}
