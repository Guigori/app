import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonth, monthLabel } from "@/lib/format";

interface MonthSelectorProps {
  month: string;
  onChange: (month: string) => void;
}

export function MonthSelector({ month, onChange }: MonthSelectorProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange(addMonth(month, -1))}
        aria-label="Mês anterior"
        data-testid="month-prev-button"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="flex min-w-0 items-center gap-1.5 px-1 text-center font-heading text-sm font-semibold text-foreground dashboard:min-w-36 dashboard:justify-center dashboard:px-0" data-testid="month-label">
        <CalendarDays className="h-4 w-4 shrink-0 dashboard:hidden" aria-hidden="true" />
        <span className="hidden dashboard:inline">{monthLabel(month)}</span>
        <span className="dashboard:hidden">{monthLabel(month).replace(/ de \d{4}$/, "")}</span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange(addMonth(month, 1))}
        aria-label="Próximo mês"
        data-testid="month-next-button"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
