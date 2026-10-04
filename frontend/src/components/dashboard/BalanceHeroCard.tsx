import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";

interface BalanceHeroCardProps {
  month: string;
  total: number;
  income: number;
  expense: number;
  onOpen: () => void;
}

export function BalanceHeroCard({ month, total, income, expense, onOpen }: BalanceHeroCardProps) {
  const { hidden, toggle } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  return (
    <div className="relative text-white" data-testid="balance-hero">
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={onOpen} className="min-w-0 text-left" data-testid="balance-open-flow">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Saldo total</p>
          <p className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-heading text-[clamp(2.25rem,11vw,4rem)] font-bold tracking-tight tabular-nums" data-testid="balance-total-value">
            {money(total)}
          </p>
          <p className="mt-1.5 text-sm text-white/55">Visão geral de {monthLabel(month)}</p>
        </button>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={hidden ? "Exibir valores" : "Ocultar valores"} data-testid="toggle-visibility-btn" className="shrink-0 text-white/65 hover:bg-white/10 hover:text-white">
          {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </Button>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6 border-t border-white/10 pt-5">
        <div data-testid="hero-month-income">
          <p className="text-sm text-white/60">Receitas do mês</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums text-income sm:text-2xl">{money(income)}</p>
        </div>
        <div className="text-right" data-testid="hero-month-expense">
          <p className="text-sm text-white/60">Despesas do mês</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums text-expense sm:text-2xl">{money(expense)}</p>
        </div>
      </div>
    </div>
  );
}
