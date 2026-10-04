
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonth, monthLabel } from "@/lib/format";

interface MonthSelectorProps {
  month: string;
  onChange: (month: string) => void;
}

export function MonthSelector({ month, onChange }: MonthSelectorProps) {
  return (
    <>
      <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-28 text-center font-heading text-sm font-semibold sm:min-w-36">{monthLabel(month)}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonth(month, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

    </>
  );
}
