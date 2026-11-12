import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { benefitTiles } from "@/lib/walletSummary";
import type { Account } from "@/types/finnos";

const GRADIENTS = [
  "linear-gradient(150deg, #00A86B, #00694A)",
  "linear-gradient(150deg, #F59E0B, #C2410C)",
  "linear-gradient(150deg, #0EA5E9, #1D4ED8)",
  "linear-gradient(150deg, #EC4899, #9D174D)",
  "linear-gradient(150deg, #8B5CF6, #5B21B6)",
  "linear-gradient(150deg, #14B8A6, #0F766E)",
  "linear-gradient(150deg, #EF4444, #991B1B)",
  "linear-gradient(150deg, #64748B, #1E293B)",
];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Prototype "Benefícios": a coloured tile per benefit, with what is left of the month and the pace. */
export function BenefitList({ accounts, hidden, onOpen }: { accounts: Account[]; hidden: boolean; onOpen: (a: Account) => void }) {
  const tiles = benefitTiles(accounts);
  if (!tiles.length) return null;
  const money = (cents: number) => (hidden ? formatHiddenBRL() : formatBRL(cents / 100).replace(/,00$/, ""));
  const days = [...new Set(tiles.filter((t) => t.monthlyCents > 0).map((t) => t.day))];
  return (
    <section aria-label="Benefícios" data-testid="wallet-benefits">
      <div className="mx-1 mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold">Benefícios</h2>
        {days.length === 1 ? <span className="text-[13px] text-muted-foreground">recarga dia {days[0]}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t, i) => (
          <button key={t.key} type="button" onClick={() => onOpen(t.account)} data-testid={`wallet-benefit-mini-${t.key.split(":")[1]}`}
            className="flex h-[150px] flex-col justify-between rounded-[22px] p-3.5 text-left text-white" style={{ background: GRADIENTS[i % GRADIENTS.length] }}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{t.name}</span>
              {t.name !== t.cardName ? <span className="block truncate text-[11px] opacity-80">{t.cardName}</span> : null}
            </span>
            <span>
              <span className="block font-heading text-[22px] font-bold tabular-nums">{money(t.cents)}</span>
              {t.left !== null ? (
                <span className="mt-2 block h-[5px] rounded-full bg-white/25"><span className="block h-full rounded-full bg-white" style={{ width: `${Math.round(t.left * 100)}%` }} /></span>
              ) : null}
              <span className="mt-1.5 block text-[11px] opacity-85">
                {t.left !== null ? `${Math.round(t.left * 100)}% restante · ` : ""}{t.runsOut ? `acaba ~${ddmm(t.runsOut)}` : t.cents > 0 ? "no ritmo" : "sem saldo"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
