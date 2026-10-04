import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";

interface BalanceHeroCardProps {
  total: number;
  onOpen: () => void;
}

export function BalanceHeroCard({ total, onOpen }: BalanceHeroCardProps) {
  const { hidden } = useBalanceHidden();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  return (
    <div className="relative text-foreground dark:text-white" data-testid="balance-hero">
      <button type="button" onClick={onOpen} className="min-w-0 text-left" data-testid="balance-open-flow">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/65 dark:text-white/60">Saldo total</p>
        <p className="mt-2 max-w-full whitespace-nowrap font-heading text-[clamp(1.9rem,9.5vw,4rem)] font-bold tracking-tight tabular-nums" data-testid="balance-total-value">
          {money(total)}
        </p>
      </button>
    </div>
  );
}
