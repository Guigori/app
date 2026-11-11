/**
 * Gráficos FINNOS (Configurações → Gráficos): the only chart types the analysis library draws, with fixed colour meaning.
 * Composição → Donut · Comportamento → Mapa de calor · Futuro → Linha de projeção · Progresso → Gauge / Barra
 * segmentada · Limite → Bullet chart · Tendência rápida → Sparkline ·
 * Comparação → Barras.
 */
import { useState } from "react";
import { motion } from "motion/react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export { Sparkline } from "@/components/dashboard/Sparkline";

/** Colour semantics: the same meaning in every chart. */
export const FINNOS_COLOR = {
  income: "var(--income)",
  expense: "var(--expense)",
  /** Estimativa: the same colour as its series, drawn dashed (never a colour of its own). */
  forecast: "var(--finnos-purple)",
  result: "var(--finnos-purple)",
  structure: "var(--finnos-app)",
  highlight: "var(--finnos-violet)",
} as const;

export interface ProjectionPoint { value: number; kind: "real" | "previsto"; label?: string }

/** Linha de projeção: real in a solid line, the estimate dashed in the same colour, "hoje" at the joint (like the Início chart). */
export function ProjectionLine({ points, height = 96, labels = true, className, ariaLabel, format }: { points: ProjectionPoint[]; height?: number; labels?: boolean; className?: string; ariaLabel?: string; format?: (v: number) => string }) {
  // Touch or hover a point to read it; touch the same point again to go back.
  const [pick, setPick] = useState<number | null>(null);
  if (points.length < 2) return null;
  const w = 320, pad = 10, top = labels ? 18 : 8, bottom = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0 < Math.min(...values) ? Math.min(...values) : 0), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => top + (1 - (v - min) / span) * (height - top - bottom);
  const lastReal = points.map((p) => p.kind).lastIndexOf("real");
  const real = points.slice(0, lastReal + 1).map((p, i) => [x(i), y(p.value)] as const);
  const future = lastReal >= 0 ? points.slice(lastReal).map((p, i) => [x(i + lastReal), y(p.value)] as const) : [];
  const dots = false;
  const end = future.at(-1);
  const indexAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * w;
    return Math.max(0, Math.min(points.length - 1, Math.round(((vx - pad) / (w - pad * 2)) * (points.length - 1))));
  };
  const picked = pick !== null ? points[pick] : null;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={cn("h-auto w-full touch-pan-y overflow-visible", format && "cursor-crosshair", className)} role="img" aria-label={ariaLabel}
      {...(format ? {
        "data-chart-interactive": "",
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { const i = indexAt(e); setPick((cur) => (e.pointerType !== "mouse" && cur === i ? null : i)); },
        onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse" || e.buttons) setPick(indexAt(e)); },
        onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setPick(null); },
      } : {})}>
      {min < 0 ? <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke={FINNOS_COLOR.expense} strokeOpacity="0.45" strokeDasharray="3 4" /> : null}
      <line x1={pad} x2={w - pad} y1={height - bottom} y2={height - bottom} stroke="var(--border)" strokeWidth="1.5" />
      {real.length > 1 ? <motion.polyline initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} points={real.map((p) => p.join(",")).join(" ")} fill="none" stroke={FINNOS_COLOR.result} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {real.map(([px, py], i) => (dots || i === real.length - 1 ? <circle key={i} cx={px} cy={py} r="4.5" fill="var(--card)" stroke={FINNOS_COLOR.result} strokeWidth="2.5" /> : null))}
      {future.length > 1 ? <motion.polyline initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.4 }} points={future.map((p) => p.join(",")).join(" ")} fill="none" stroke={FINNOS_COLOR.result} strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {end && future.length > 1 ? <circle cx={end[0]} cy={end[1]} r="4.5" fill="var(--card)" stroke={FINNOS_COLOR.result} strokeWidth="2.5" /> : null}
      {picked && format ? (() => {
        const px = x(pick!), py = y(picked.value);
        const label = `${picked.label ? `${picked.label} · ` : ""}${format(picked.value)}${picked.kind === "previsto" ? " (estimativa)" : ""}`;
        const anchor = px < w * 0.25 ? "start" : px > w * 0.75 ? "end" : "middle";
        return (
          <g data-testid="projection-pick">
            <line x1={px} x2={px} y1={top - 4} y2={height - bottom} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeDasharray="2 3" />
            <circle cx={px} cy={py} r="5.5" fill={FINNOS_COLOR.result} stroke="var(--card)" strokeWidth="2" />
            <text x={px} y={Math.max(11, py - 12)} textAnchor={anchor} fontSize="12" fontWeight="600" fill="var(--foreground)" paintOrder="stroke" stroke="var(--card)" strokeWidth="4">{label}</text>
          </g>
        );
      })() : null}
      {labels && !picked && lastReal >= 0 && future.length > 1 ? (
        <>
          <text x={real.at(-1)![0]} y="11" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">hoje</text>
          <text x={end![0]} y="11" textAnchor="end" fontSize="11" fill="var(--muted-foreground)">estimativa</text>
        </>
      ) : null}
    </svg>
  );
}

export interface Segment { value: number; color: string; label?: string; striped?: boolean }

/** Barra segmentada: parts of one whole side by side (used, committed, free…). */
export function SegmentedBar({ segments, total, className, height = 10 }: { segments: Segment[]; total?: number; className?: string; height?: number }) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className={cn("flex w-full gap-0.5 overflow-hidden rounded-full bg-muted", className)} style={{ height }} role="img"
      aria-label={segments.filter((s) => s.label).map((s) => `${s.label}: ${Math.round((s.value / Math.max(sum, 0.01)) * 100)}%`).join(", ")}>
      {segments.filter((s) => s.value > 0).map((s, i) => (
        <motion.span key={i} className="h-full first:rounded-l-full last:rounded-r-full" initial={{ width: 0 }} animate={{ width: `${(s.value / Math.max(sum, 0.01)) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.05 }}
          style={{ backgroundColor: s.striped ? undefined : s.color, backgroundImage: s.striped ? `repeating-linear-gradient(45deg, ${s.color} 0 4px, transparent 4px 8px)` : undefined }} />
      ))}
    </div>
  );
}

/** Bullet chart: the value against a limit mark; what passes the limit turns into the expense colour. */
export function BulletBar({ value, limit, max, color = FINNOS_COLOR.result, className }: { value: number; limit: number; max?: number; color?: string; className?: string }) {
  const scale = Math.max(max ?? 0, value, limit) * 1.08 || 1;
  const within = Math.min(value, limit), over = Math.max(0, value - limit);
  return (
    <div className={cn("relative h-3 w-full rounded-full bg-muted", className)} role="img" aria-label={`${Math.round((value / Math.max(limit, 0.01)) * 100)}% do limite`}>
      <motion.div className="absolute inset-y-0 left-0 rounded-l-full" initial={{ width: 0 }} animate={{ width: `${(within / scale) * 100}%` }} style={{ backgroundColor: over > 0 ? FINNOS_COLOR.expense : color, borderRadius: over > 0 ? undefined : 9999 }} />
      {over > 0 ? <motion.div className="absolute inset-y-0 rounded-r-full" initial={{ width: 0 }} animate={{ width: `${(over / scale) * 100}%` }} style={{ left: `${(limit / scale) * 100}%`, backgroundColor: FINNOS_COLOR.expense }} /> : null}
      <span className="absolute -bottom-1.5 -top-1.5 w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${(limit / scale) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** Gauge: a half ring with the share used; turns the expense colour past 100%. */
export function Gauge({ percent, children, size = 168, className }: { percent: number; children?: React.ReactNode; size?: number; className?: string }) {
  const p = Math.max(0, Math.min(1, percent));
  const color = percent > 1 ? FINNOS_COLOR.expense : FINNOS_COLOR.result;
  const r = 70, c = Math.PI * r;
  return (
    <div className={cn("relative mx-auto", className)} style={{ width: size, height: size / 2 + 8 }}>
      <svg viewBox="0 0 168 92" className="h-full w-full" aria-hidden="true">
        <path d="M14 84a70 70 0 0 1 140 0" fill="none" stroke="var(--muted)" strokeWidth="16" strokeLinecap="round" />
        <motion.path d="M14 84a70 70 0 0 1 140 0" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - p) }} transition={{ duration: 0.7 }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">{children}</div>
    </div>
  );
}

export interface BarDatum { label: string; value: number; focus?: boolean; future?: boolean; valueLabel?: string }

/** Barras: values side by side from zero; the one in focus in purple, estimated months dashed in the same purple. */
export function Bars({ data, height = 112, onPick, className }: { data: BarDatum[]; height?: number; onPick?: (d: BarDatum) => void; className?: string }) {
  const peak = Math.max(1, ...data.map((d) => d.value));
  // Without its own action, a bar is selected by touch (the others fade) and released by touching it again.
  const [sel, setSel] = useState<number | null>(null);
  return (
    <div className={cn("flex items-end gap-2", className)} style={{ height }}>
      {data.map((d, i) => {
        const body = (
          <>
            <span className="text-[10px] tabular-nums text-muted-foreground">{d.valueLabel ?? ""}</span>
            <motion.span className="block w-full rounded-lg" initial={{ height: 0 }} animate={{ height: Math.max(4, (d.value / peak) * (height - 36)), opacity: sel !== null && sel !== i ? 0.35 : 1 }} transition={{ delay: i * 0.04 }}
              style={d.future ? { backgroundColor: "color-mix(in srgb, var(--finnos-purple) 18%, transparent)", outline: "1.5px dashed color-mix(in srgb, var(--finnos-purple) 70%, transparent)", outlineOffset: -1.5 } : { backgroundColor: d.focus ? FINNOS_COLOR.result : "color-mix(in srgb, var(--finnos-purple) 32%, var(--background))" }} />
            <span className={cn("text-[11px]", d.focus ? "font-semibold text-foreground" : "text-muted-foreground")}>{d.label}</span>
          </>
        );
        return onPick ? (
          <button key={d.label + i} type="button" onClick={() => onPick(d)} aria-pressed={d.focus} aria-label={`${d.label}: ${d.valueLabel ?? d.value}`} className="flex flex-1 flex-col items-center gap-1">{body}</button>
        ) : <button key={d.label + i} type="button" data-chart-interactive="" onClick={(e) => { e.stopPropagation(); setSel(sel === i ? null : i); }} aria-pressed={sel === i} aria-label={`${d.label}: ${d.valueLabel ?? d.value}`} className="flex flex-1 flex-col items-center gap-1">{body}</button>;
      })}
    </div>
  );
}

export interface DonutSlice { id: string; name: string; value: number; color: string }

/**
 * Donut FINNOS (Composição): the same chart as "Pra onde foi o dinheiro?" — rounded segments with a gap between them,
 * the growing animation, and selection: tap a slice to focus it (the others fade and the centre shows it), tap it again to
 * go back to the whole. The centre shows the total, or the focused slice.
 */
export function Donut({ slices, size = 176, selectedId, onSelect, centerLabel = "Total", format, className }: {
  slices: DonutSlice[]; size?: number; selectedId?: string | null; onSelect?: (id: string | null) => void;
  centerLabel?: string; format: (v: number) => string; className?: string;
}) {
  const selected = selectedId ? slices.find((s) => s.id === selectedId) ?? null : null;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const small = size < 120;
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      data-testid="finnos-donut"
      data-chart-interactive=""
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onSelect?.(null); }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="98%" paddingAngle={slices.length > 1 ? 2 : 0} cornerRadius={small ? 4 : 6} strokeWidth={0}
            isAnimationActive animationDuration={700} animationEasing="ease-out"
            onClick={(_, i) => { const s = slices[i]; if (s) onSelect?.(selected?.id === s.id ? null : s.id); }}>
            {slices.map((s) => <Cell key={s.id} fill={s.color} opacity={selected && s.id !== selected.id ? 0.22 : 1} style={{ transition: "opacity 200ms ease", cursor: onSelect ? "pointer" : undefined, outline: "none" }} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[18%] text-center">
        {small ? (
          <p className="max-w-full truncate text-[12px] font-semibold tabular-nums">{selected ? `${Math.round((selected.value / Math.max(total, 0.01)) * 100)}%` : ""}</p>
        ) : (
          <>
            <p className="max-w-full truncate text-[11px] text-muted-foreground">{selected ? selected.name : centerLabel}</p>
            <p className="max-w-full truncate font-heading text-[15px] font-bold tabular-nums">{format(selected ? selected.value : total)}</p>
          </>
        )}
      </div>
    </div>
  );
}
