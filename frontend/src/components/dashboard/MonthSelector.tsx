import { ChevronLeft, ChevronRight } from "lucide-react";
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
      <span className="min-w-36 text-center font-heading text-sm font-semibold text-foreground" data-testid="month-label">
        {monthLabel(month)}
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
