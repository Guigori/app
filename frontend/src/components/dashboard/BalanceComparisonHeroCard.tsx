import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
    <Card className="relative overflow-hidden border-0 bg-[#10142B] text-white dark:bg-[#090910]" data-testid="balance-comparison-hero">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Abrir o fluxo completo"
        className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        data-testid="balance-comparison-open-flow"
      />
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[#5B35FF]/40 blur-3xl" aria-hidden="true" />
      <CardHeader className="relative z-20 pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/60">Saldo total</p>
            <p className="mt-2 break-words font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl" data-testid="balance-total-value">
              {money(total)}
            </p>
            <p className="mt-2 text-sm text-white/60">Visão geral de {monthLabel(month)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={hidden ? "Exibir valores" : "Ocultar valores"}
            data-testid="toggle-visibility-btn"
            className="relative z-30 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
          >
            {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="relative z-20 pt-6">
        <div className="grid grid-cols-2 items-end gap-3 sm:gap-4">
          <div data-testid="comparison-month-income">
            <p className="text-sm text-white/70">Receitas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(1.15rem,5.2vw,1.5rem)] font-bold tabular-nums text-income sm:text-3xl">{money(income)}</p>
          </div>
          <div className="text-right" data-testid="comparison-month-expense">
            <p className="text-sm text-white/70">Despesas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(1.15rem,5.2vw,1.5rem)] font-bold tabular-nums text-expense sm:text-3xl">{money(expense)}</p>
          </div>
        </div>

        <div className="mt-5">
          <div
            className="flex h-7 w-full overflow-hidden rounded-full bg-white/10"
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
                  className="relative z-30 h-full cursor-pointer bg-income transition-[width,filter] duration-500 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
                  style={{ width: `${incomePercent}%` }}
                  data-testid="income-balance-segment"
                />
                <button
                  type="button"
                  onClick={onOpenExpense}
                  aria-label={`Abrir despesas de ${monthLabel(month)}`}
                  className="relative z-30 h-full cursor-pointer bg-expense transition-[width,filter] duration-500 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
                  style={{ width: `${expensePercent}%` }}
                  data-testid="expense-balance-segment"
                />
              </>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-heading text-lg font-bold tabular-nums text-income">{incomePercent}%</p>
              <p className="text-white/60">Receitas</p>
            </div>
            <div className="text-right">
              <p className="font-heading text-lg font-bold tabular-nums text-expense">{expensePercent}%</p>
              <p className="text-white/60">Despesas</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
