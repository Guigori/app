import { useId } from "react";
import { cn } from "@/lib/utils";

/** Minimal trend line for summary cards (pure SVG, no chart library).
 * Colour follows `currentColor`, so the parent's text colour themes it. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const gradient = useId();
  if (values.length < 2 || values.every((v) => v === values[0])) {
    return <div className={cn("h-10 border-b border-dashed border-current/25", className)} aria-hidden="true" />;
  }
  const w = 120;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-10 w-full overflow-visible", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
