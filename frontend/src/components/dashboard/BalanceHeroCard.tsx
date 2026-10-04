import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, monthLabel } from "@/lib/format";

interface BalanceHeroCardProps {
  month: string;
  total: number;
  income: number;
  expense: number;
  /** Clicking the card opens the full /fluxo screen. */
  onOpen: () => void;
}

export function BalanceHeroCard({ month, total, income, expense, onOpen }: BalanceHeroCardProps) {
  const { hidden, toggle } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  return (
    <Card className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/10 text-white shadow-none backdrop-blur-[2px]">
      {/* Full-card hit area, under the eye toggle (which sits above it). */}
      <button
        type="button"
        onClick={onOpen}
        aria-label="Abrir o fluxo completo"
        className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        data-testid="balance-open-flow"
      />
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#5B35FF]/20 blur-3xl" aria-hidden="true" />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/60">Saldo total</p>
            <p
              className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-heading text-[clamp(2rem,10vw,3rem)] font-bold tracking-tight tabular-nums"
              data-testid="balance-total-value"
            >
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
            className="relative z-20 text-white/70 hover:bg-white/10 hover:text-white"
          >
            {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-white/5" data-testid="hero-month-income">
            <p className="text-xs text-white/60">Receitas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(.82rem,3.7vw,1.125rem)] font-bold tracking-tight tabular-nums text-emerald-300">{money(income)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-white/5" data-testid="hero-month-expense">
            <p className="text-xs text-white/60">Despesas do mês</p>
            <p className="mt-1 whitespace-nowrap font-heading text-[clamp(.82rem,3.7vw,1.125rem)] font-bold tracking-tight tabular-nums text-rose-300">{money(expense)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
