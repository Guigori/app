import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthSelectorProps {
  month: string;
  onChange: (month: string) => void;
}

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function MonthSelector({ month, onChange }: MonthSelectorProps) {
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
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-transparent data-[state=open]:text-foreground"
          aria-label={`Escolher mês. Atual: ${monthLabel(month)}`}
          title={monthLabel(month)}
        >
          <CalendarDays className="h-5 w-5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[18rem] rounded-3xl border-border/70 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => setPickerYear(shownYear - 1)} aria-label="Ano anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <strong className="font-heading text-base">{shownYear}</strong>
            <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => setPickerYear(shownYear + 1)} aria-label="Próximo ano"><ChevronRight className="h-4 w-4" /></Button>
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
    </div>
  );
}
