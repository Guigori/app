import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { composition, type WalletIndicators as Indicators } from "@/lib/walletSummary";
import { cn } from "@/lib/utils";

const PART_STYLE: Record<string, string> = {
  accounts: "#4B2CFF",
  invested: "#8C5BFF",
  benefits: "#00A86B",
  debt: "repeating-linear-gradient(135deg, #BE123C 0 4px, #F7B6C5 4px 8px)",
};
const DOT: Record<string, string> = { accounts: "#4B2CFF", invested: "#8C5BFF", benefits: "#00A86B", debt: "#BE123C" };

/** Prototype "Seu patrimônio hoje" card. Following v1.1, the headline is the money in the accounts
 * and the four parts are shown each with its own value, never added into one number. */
export function WalletIndicators({ ind, investedCents, hidden }: { ind: Indicators; investedCents: number; hidden: boolean }) {
  const money = (cents: number) => (hidden ? formatHiddenBRL() : formatBRL(cents / 100));
  const parts = composition(ind, investedCents);
  const visible = parts.filter((p) => p.cents > 0);
  return (
    <section className="rounded-[30px] border border-border bg-card p-5" aria-label="Resumo da Carteira" data-testid="wallet-indicators">
      <p className="text-[13px] text-muted-foreground">Disponível nas contas</p>
      <p className="mt-1 font-heading text-[34px] font-bold leading-tight tracking-[-0.03em] tabular-nums" data-testid="wallet-balance"
        title="Contas e dinheiro em espécie. Investimentos, benefícios e cartões aparecem à parte.">{money(ind.cashCents)}</p>
      {visible.length ? (
        <div className="mt-4 flex h-3 gap-[3px]" role="img" aria-label={visible.map((p) => `${p.label}: ${Math.round(p.share * 100)}%`).join(", ")} data-testid="wallet-composition">
          {visible.map((p, i) => (
            <span key={p.key} style={{ flex: p.cents, background: PART_STYLE[p.key] }}
              className={cn("rounded-[3px]", i === 0 && "rounded-l-full", i === visible.length - 1 && "rounded-r-full")} />
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {parts.map((p) => (
          <p key={p.key} className="flex gap-2" data-testid={`wallet-ind-${p.key}`}>
            <span className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: DOT[p.key] }} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">{p.label}</span>
              <strong className={cn("block text-[15px] tabular-nums", p.key === "debt" && p.cents > 0 && "text-expense")}>
                {p.key === "debt" && p.cents > 0 && !hidden ? "− " : ""}{money(p.cents)}
              </strong>
            </span>
          </p>
        ))}
      </div>
    </section>
  );
}
