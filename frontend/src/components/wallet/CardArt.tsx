import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The card as FINNOS draws it: the name the person gave, the bank, the last digits and the
 * invoice. It does not imitate a real card, so there is no chip and no card network logo. */
export function CardArt({ name, institution, color, lastDigits, invoice, label = "Fatura atual", hidden, isDefault, className }: {
  name: string;
  institution: string;
  color: string;
  lastDigits?: string | null;
  invoice?: number | null;
  label?: string;
  hidden?: boolean;
  isDefault?: boolean;
  className?: string;
}) {
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color : "#5B35FF";
  return (
    <div
      className={cn("relative flex aspect-[1.586/1] w-full flex-col justify-between overflow-hidden rounded-[22px] p-4 text-white shadow-md", className)}
      style={{ background: `linear-gradient(135deg, ${base} 0%, ${base}CC 55%, #0B1026 140%)` }}
      data-testid="card-art"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight">{name || "Nome do cartão"}</p>
          <p className="truncate text-xs text-white/80">{institution || "Banco"}</p>
        </div>
        {isDefault ? <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">Padrão</span> : null}
      </div>
      <div className="relative flex items-end justify-between gap-2">
        <div className="min-w-0">
          {invoice != null ? (
            <>
              <p className="text-[11px] text-white/75">{label}</p>
              <p className="font-heading text-xl font-bold tabular-nums">{hidden ? formatHiddenBRL() : formatBRL(invoice)}</p>
            </>
          ) : null}
        </div>
        <p className="shrink-0 font-mono text-sm tracking-widest text-white/90" aria-label={lastDigits ? `Final ${lastDigits}` : undefined}>
          {lastDigits ? `•••• ${lastDigits}` : ""}
        </p>
      </div>
    </div>
  );
}
