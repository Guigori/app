import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";

interface BalanceComparisonHeroCardProps {
  month: string;
  total: number;
  income: number;
  expense: number;
  onOpen: () => void;
  onOpenIncome: () => void;
  onOpenExpense: () => void;
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function BalanceComparisonHeroCard({ month, total, income, expense, onOpen, onOpenIncome, onOpenExpense }: BalanceComparisonHeroCardProps) {
  const { hidden, toggle } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const moved = Math.max(income, 0) + Math.max(expense, 0);
  const incomePercent = percent(Math.max(income, 0), moved);
  const expensePercent = moved > 0 ? 100 - incomePercent : 0;
  const hasMovement = moved > 0;

  return (
    <div className="relative text-foreground dark:text-white" data-testid="balance-comparison-hero">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Abrir o fluxo completo"
        className="absolute inset-x-0 top-0 z-10 h-28 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60 dark:focus-visible:outline-white/70"
        data-testid="balance-comparison-open-flow"
      />
      <div className="relative z-20">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground/65 dark:text-white/60">Saldo total</p>
            <p className="mt-2 whitespace-nowrap font-heading text-[clamp(1.9rem,9.5vw,3rem)] font-bold tracking-tight tabular-nums" data-testid="balance-total-value">
              {money(total)}
            </p>
            <p className="mt-2 text-sm text-foreground/65 dark:text-white/60">Visão geral de {monthLabel(month)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={hidden ? "Exibir valores" : "Ocultar valores"}
            data-testid="toggle-visibility-btn"
            className="relative z-30 shrink-0 text-foreground/70 dark:text-white/70 hover:bg-primary/5 dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white"
          >
            {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      <div className="relative z-20 pt-8">
        <div className="grid grid-cols-2 items-end gap-3 border-t border-border/80 dark:border-white/10 pt-5 sm:gap-4">
          <div data-testid="comparison-month-income">
            <p className="text-sm text-foreground/70 dark:text-white/70">Receitas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(1rem,4.8vw,1.5rem)] font-bold tabular-nums text-income sm:text-3xl">{money(income)}</p>
          </div>
          <div className="text-right" data-testid="comparison-month-expense">
            <p className="text-sm text-foreground/70 dark:text-white/70">Despesas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(1rem,4.8vw,1.5rem)] font-bold tabular-nums text-expense sm:text-3xl">{money(expense)}</p>
          </div>
        </div>

        <div className="mt-5">
          <div
            className="relative flex h-3 w-full overflow-hidden rounded-full bg-muted dark:bg-white/10"
            role="img"
            aria-label={`Receitas ${incomePercent}% e despesas ${expensePercent}%`}
            data-testid="income-expense-balance-bar"
          >
            {hasMovement ? (
              <>
                <button
                  type="button"
                  onClick={onOpenIncome}
                  aria-label={`Abrir receitas de ${monthLabel(month)}`}
                  className="relative z-30 h-full cursor-pointer bg-income transition-[width,filter] duration-500 ease-out hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:focus-visible:ring-white/70"
                  style={{ width: `${incomePercent}%` }}
                  data-testid="income-balance-segment"
                />
                <span className="pointer-events-none absolute inset-y-0 z-40 w-px bg-background/90 dark:bg-white/35" style={{ left: `${incomePercent}%` }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={onOpenExpense}
                  aria-label={`Abrir despesas de ${monthLabel(month)}`}
                  className="relative z-30 h-full cursor-pointer bg-expense transition-[width,filter] duration-500 ease-out hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 dark:focus-visible:ring-white/70"
                  style={{ width: `${expensePercent}%` }}
                  data-testid="expense-balance-segment"
                />
              </>
            ) : null}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <button type="button" onClick={onOpenIncome} className="inline-flex items-center gap-1.5 rounded-md py-1 hover:text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-income" aria-hidden="true" />
              <span>Receitas</span>
              <strong className="font-heading font-semibold tabular-nums text-foreground">{incomePercent}%</strong>
            </button>
            <button type="button" onClick={onOpenExpense} className="inline-flex items-center gap-1.5 rounded-md py-1 text-right hover:text-foreground">
              <strong className="font-heading font-semibold tabular-nums text-foreground">{expensePercent}%</strong>
              <span>Despesas</span>
              <span className="h-1.5 w-1.5 rounded-full bg-expense" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
