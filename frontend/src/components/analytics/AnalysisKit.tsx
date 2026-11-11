import { useRef, type ReactNode } from "react";
import { useInView } from "motion/react";
import { CircleCheck, Eye, EyeOff, Sparkles, TriangleAlert } from "lucide-react";
import { useBalanceHidden } from "@/lib/balance";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthSelector } from "@/components/dashboard/MonthSelector";

/** Shared pieces of the Análise sub-screens: header, stat tiles, chart cards, legend, tooltip. */

export function AnalysisHeader({ title, month, onMonthChange, children }: { title: string; month?: string; onMonthChange?: (m: string) => void; children?: ReactNode }) {
  const { hidden, toggle } = useBalanceHidden();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        {month ? <p data-keep className="mt-0.5 text-sm text-muted-foreground">{monthLabel(month)}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        {children}
        <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} aria-pressed={hidden} className="inline-flex size-10 items-center justify-center rounded-full text-foreground/75 hover:bg-muted">
          {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
        {month && onMonthChange ? <MonthSelector month={month} onChange={onMonthChange} /> : null}
      </div>
    </header>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: string; note?: ReactNode; tone?: "income" | "expense" }) {
  return (
    <div className="min-w-0 rounded-3xl border border-border/80 bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 whitespace-nowrap font-heading text-[clamp(1rem,4.8vw,1.25rem)] font-bold tabular-nums", tone === "income" && "text-income", tone === "expense" && "text-expense")}>{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** Tiles side by side; an odd one at the end takes the whole row instead of leaving a hole. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">{children}</div>;
}

export function ChartCard({ title, subtitle, legend, children, className }: { title: string; subtitle?: string; legend?: Array<{ label: string; color: string; dashed?: boolean }>; children: ReactNode; className?: string }) {
  // The chart is drawn (and animates) when the card comes into view, like the Gráficos FINNOS.
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.25 });
  return (
    <section ref={ref} className={cn("min-w-0 rounded-3xl border border-border/80 bg-card p-5 shadow-sm", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {legend?.length ? (
          <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Legenda">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                <span className={cn("h-0.5 w-4 rounded-full", item.dashed && "border-t-2 border-dashed bg-transparent")} style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color, height: 8, width: 8, borderRadius: 3 }} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-3" key={seen ? "seen" : "waiting"}>{children}</div>
    </section>
  );
}

/** One plain-language finding, the reason the screen exists. */
export function Finding({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "attention" }) {
  // Same look as the library findings: a calm card, the tone only in the icon (no coloured fills).
  const Icon = tone === "good" ? CircleCheck : tone === "attention" ? TriangleAlert : Sparkles;
  return (
    <div className="flex gap-3 rounded-3xl border border-border/80 bg-card p-4 text-sm leading-relaxed shadow-sm" data-tone={tone}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "good" ? "text-income" : tone === "attention" ? "text-expense" : "text-primary")} aria-hidden="true" />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cn("h-8 rounded-full px-3 text-xs font-semibold transition-colors", value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
