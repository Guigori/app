/**
 * Gráficos FINNOS for the charts drawn with recharts (Início, Fluxo): the same grid, axes, tooltip, lines, estimate
 * and bars as the library charts, so every chart of the app reads the same way.
 */
import { useRef, type ReactNode } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

export const FINNOS_SERIES = { income: "var(--income)", expense: "var(--expense)", result: "var(--finnos-purple)" } as const;

export const finnosGrid = { vertical: false, stroke: "var(--border)", strokeOpacity: 0.55, strokeDasharray: "3 6" } as const;
export const finnosAxisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
export const finnosTooltip = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 14, color: "var(--popover-foreground)", fontSize: 12, boxShadow: "0 12px 32px rgba(0,0,0,.16)", padding: "8px 12px" },
  itemStyle: { color: "var(--popover-foreground)", padding: "1px 0" },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 4 },
} as const;
/** Real values: a solid line. */
export const finnosReal = (color: string) => ({ stroke: color, strokeWidth: 2.5, dot: false, activeDot: { r: 5, fill: color, stroke: "var(--background)", strokeWidth: 2 } });
/** Estimates: the same colour, dashed and a little lighter (never another colour). */
export const finnosEstimate = (color: string) => ({ stroke: color, strokeOpacity: 0.7, strokeWidth: 2.25, strokeDasharray: "6 6", dot: false, activeDot: { r: 5, fill: "var(--background)", stroke: color, strokeWidth: 2.5 } });
export const finnosBar = { radius: [6, 6, 0, 0] as [number, number, number, number], maxBarSize: 22 };
export const finnosAnimation = { isAnimationActive: true, animationDuration: 800, animationEasing: "ease-out" as const };

/** Draws (and animates) the chart when it comes into view, like the library charts. */
export function ChartReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.2 });
  return <div ref={ref} className={cn("select-none", className)} data-chart-interactive="" key={seen ? "s" : "w"}>{seen ? children : null}</div>;
}

/** The legend/filter chip of a series: a dot and the name; on → filled card, off → muted. */
export function SeriesChip({ on, color, label, onClick, testId, dashed }: { on: boolean; color: string; label: string; onClick?: () => void; testId?: string; dashed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", on ? "border-border bg-muted text-foreground" : "border-border/60 bg-transparent text-muted-foreground")}>
      {dashed ? <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: color }} aria-hidden="true" /> : <span className="size-2 rounded-full" style={{ backgroundColor: color, opacity: on ? 1 : 0.5 }} aria-hidden="true" />}
      {label}
    </button>
  );
}
