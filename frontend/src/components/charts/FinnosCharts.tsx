/**
 * Gráficos FINNOS (Configurações → Gráficos): the only chart types the analysis library draws, with fixed colour meaning.
 * Composição → Donut · Comportamento → Mapa de calor · Futuro → Linha de projeção · Progresso → Gauge / Barra
 * segmentada · Limite → Bullet chart · Tendência rápida → Sparkline ·
 * Comparação → Barras.
 */
import { useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
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
/** With `area`, the real part gets a soft fill below it: the Sparkline of the grammar (tendência rápida). */
export function ProjectionLine({ points, height = 96, labels = true, className, ariaLabel, format, area = false }: { points: ProjectionPoint[]; height?: number; labels?: boolean; className?: string; ariaLabel?: string; format?: (v: number) => string; area?: boolean }) {
  // Touch or hover a point to read it; touch the same point again to go back.
  const [pick, setPick] = useState<number | null>(null);
  const [ref, seen] = useSeen<SVGSVGElement>();
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
    <svg ref={ref} viewBox={`0 0 ${w} ${height}`} className={cn("h-auto w-full touch-pan-y overflow-visible", format && "cursor-crosshair", className)} role="img" aria-label={ariaLabel}
      {...(format ? {
        "data-chart-interactive": "",
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { const i = indexAt(e); setPick((cur) => (e.pointerType !== "mouse" && cur === i ? null : i)); },
        onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse" || e.buttons) setPick(indexAt(e)); },
        onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setPick(null); },
      } : {})}>
      {min < 0 ? <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke={FINNOS_COLOR.expense} strokeOpacity="0.45" strokeDasharray="3 4" /> : null}
      <line x1={pad} x2={w - pad} y1={height - bottom} y2={height - bottom} stroke="var(--border)" strokeWidth="1.5" />
      {area && real.length > 1 ? <motion.polygon initial={{ opacity: 0 }} animate={{ opacity: seen ? 0.14 : 0 }} transition={{ delay: 0.5, duration: 0.5 }} fill={FINNOS_COLOR.result} points={[...real.map((p) => p.join(",")), `${real.at(-1)![0]},${height - bottom}`, `${real[0][0]},${height - bottom}`].join(" ")} /> : null}
      {real.length > 1 ? <motion.polyline initial={{ pathLength: 0 }} animate={{ pathLength: seen ? 1 : 0 }} transition={{ duration: 0.8, ease: "easeOut" }} points={real.map((p) => p.join(",")).join(" ")} fill="none" stroke={FINNOS_COLOR.result} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {real.map(([px, py], i) => (dots || i === real.length - 1 ? <motion.circle initial={{ scale: 0 }} animate={{ scale: seen ? 1 : 0 }} transition={{ delay: 0.7, type: "spring", stiffness: 400, damping: 18 }} style={{ transformOrigin: `${px}px ${py}px` }} key={i} cx={px} cy={py} r="4.5" fill="var(--card)" stroke={FINNOS_COLOR.result} strokeWidth="2.5" /> : null))}
      {future.length > 1 ? <motion.polyline initial={{ pathLength: 0, opacity: 0 }} animate={seen ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }} transition={{ delay: 0.75, duration: 0.7, ease: "easeOut" }} points={future.map((p) => p.join(",")).join(" ")} fill="none" stroke={FINNOS_COLOR.result} strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {end && future.length > 1 ? <motion.circle initial={{ scale: 0 }} animate={{ scale: seen ? 1 : 0 }} transition={{ delay: 1.4, type: "spring", stiffness: 400, damping: 18 }} style={{ transformOrigin: `${end[0]}px ${end[1]}px` }} cx={end[0]} cy={end[1]} r="4.5" fill="var(--card)" stroke={FINNOS_COLOR.result} strokeWidth="2.5" /> : null}
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

/** Charts animate when they come into view (not while still below the fold), once. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const seen = useInView(ref, { once: true, amount: 0.3 });
  return [ref, seen] as const;
}

/** The bubble a touched chart shows over the part that was touched (bars, limits). */
function Callout({ at, children }: { at: number; children: React.ReactNode }) {
  const left = Math.max(14, Math.min(86, at));
  return (
    <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.15 }}
      className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[11px] font-semibold tabular-nums text-background shadow-md"
      style={{ left: `${left}%` }} data-testid="chart-callout">{children}</motion.span>
  );
}
const pct = (v: number, total: number) => `${Math.round((v / Math.max(total, 0.01)) * 100)}%`;

export interface Segment { value: number; color: string; label?: string; striped?: boolean }

/** Barra segmentada: parts of one whole side by side (used, committed, free…). Touch a part to read it, touch again to go back. */
export function SegmentedBar({ segments, total, className, height = 10, format }: { segments: Segment[]; total?: number; className?: string; height?: number; format?: (v: number) => string }) {
  const [sel, setSel] = useState<number | null>(null);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.map((s, i) => ({ ...s, i })).filter((s) => s.value > 0);
  let acc = 0;
  const centers = shown.map((s) => { const c = acc + s.value / 2; acc += s.value; return (c / Math.max(sum, 0.01)) * 100; });
  const picked = shown.findIndex((s) => s.i === sel);
  return (
    <div ref={ref} className={cn("relative w-full", className)} data-chart-interactive="" onClick={(e) => e.stopPropagation()}>
      <AnimatePresence>{picked >= 0 ? <Callout key={sel} at={centers[picked]}>{shown[picked].label ? `${shown[picked].label} · ` : ""}{format ? `${format(shown[picked].value)} · ` : ""}{pct(shown[picked].value, sum)}</Callout> : null}</AnimatePresence>
      <div className="flex w-full gap-0.5 overflow-hidden rounded-full bg-muted" style={{ height: Math.max(height, 8) }} role="img"
        aria-label={segments.filter((s) => s.label).map((s) => `${s.label}: ${pct(s.value, sum)}`).join(", ")}>
        {shown.map((s, k) => (
          <motion.span key={s.i} className="h-full cursor-pointer first:rounded-l-full last:rounded-r-full" initial={{ width: 0 }} animate={{ width: seen ? `${(s.value / Math.max(sum, 0.01)) * 100}%` : "0%", opacity: sel !== null && sel !== s.i ? 0.3 : 1 }} transition={{ duration: 0.7, delay: k * 0.12, ease: "easeOut" }}
            onClick={() => setSel(sel === s.i ? null : s.i)}
            style={{ backgroundColor: s.striped ? undefined : s.color, backgroundImage: s.striped ? `repeating-linear-gradient(45deg, ${s.color} 0 4px, transparent 4px 8px)` : undefined }} />
        ))}
      </div>
    </div>
  );
}

/** Bullet chart: the value against a limit mark; what passes the limit turns into the expense colour. Touch it to read value and limit. */
export function BulletBar({ value, limit, max, color = FINNOS_COLOR.result, className, format }: { value: number; limit: number; max?: number; color?: string; className?: string; format?: (v: number) => string }) {
  const [open, setOpen] = useState(false);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const scale = Math.max(max ?? 0, value, limit) * 1.08 || 1;
  const within = Math.min(value, limit), over = Math.max(0, value - limit);
  const f = format ?? ((v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
  return (
    <div ref={ref} className={cn("relative h-3 w-full cursor-pointer rounded-full bg-muted", className)} role="img" aria-label={`${pct(value, limit)} do limite`}
      data-chart-interactive="" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
      <AnimatePresence>{open ? <Callout at={(value / scale) * 100}>{f(value)} de {f(limit)} · {pct(value, limit)}{over > 0 ? ` · passou ${f(over)}` : ""}</Callout> : null}</AnimatePresence>
      <motion.div className="absolute inset-y-0 left-0 rounded-l-full" initial={{ width: 0 }} animate={{ width: seen ? `${(within / scale) * 100}%` : "0%", scaleY: open ? 1.25 : 1 }} transition={{ duration: 0.7, ease: "easeOut" }} style={{ backgroundColor: over > 0 ? FINNOS_COLOR.expense : color, borderRadius: over > 0 ? undefined : 9999 }} />
      {over > 0 ? <motion.div className="absolute inset-y-0 rounded-r-full" initial={{ width: 0 }} animate={{ width: seen ? `${(over / scale) * 100}%` : "0%", scaleY: open ? 1.25 : 1 }} transition={{ duration: 0.4, delay: 0.7, ease: "easeOut" }} style={{ left: `${(limit / scale) * 100}%`, backgroundColor: FINNOS_COLOR.expense }} /> : null}
      <span className="absolute -bottom-1.5 -top-1.5 w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${(limit / scale) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** Gauge: a half ring with the share used; turns the expense colour past 100%. Touch it to swap the centre for the detail, again to go back. */
export function Gauge({ percent, children, detail, size = 168, className }: { percent: number; children?: React.ReactNode; detail?: React.ReactNode; size?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const p = Math.max(0, Math.min(1, percent));
  const color = percent > 1 ? FINNOS_COLOR.expense : FINNOS_COLOR.result;
  const r = 70, c = Math.PI * r;
  return (
    <div ref={ref} className={cn("relative mx-auto", detail && "cursor-pointer", className)} style={{ width: size, height: size / 2 + 8 }}
      {...(detail ? { "data-chart-interactive": "", onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen((o) => !o); } } : {})}>
      <svg viewBox="0 0 168 92" className="h-full w-full overflow-visible" aria-hidden="true">
        <path d="M14 84a70 70 0 0 1 140 0" fill="none" stroke="var(--muted)" strokeWidth="16" strokeLinecap="round" />
        <motion.path d="M14 84a70 70 0 0 1 140 0" fill="none" stroke={color} strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c, strokeWidth: 16 }} animate={{ strokeDashoffset: seen ? c * (1 - p) : c, strokeWidth: open ? 20 : 16 }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={open ? "d" : "c"} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }}>{open && detail ? <span className="block text-[10px] font-semibold leading-tight tabular-nums">{detail}</span> : children}</motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export interface BarDatum { label: string; value: number; focus?: boolean; future?: boolean; valueLabel?: string }

/** Barras: values side by side from zero; the one in focus in purple, estimated months dashed in the same purple. */
export function Bars({ data, height = 112, onPick, className }: { data: BarDatum[]; height?: number; onPick?: (d: BarDatum) => void; className?: string }) {
  const peak = Math.max(1, ...data.map((d) => d.value));
  // Without its own action, a bar is selected by touch (the others fade) and released by touching it again.
  const [sel, setSel] = useState<number | null>(null);
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("flex items-end gap-2", className)} style={{ height }}>
      {data.map((d, i) => {
        const body = (
          <>
            <span className="text-[10px] tabular-nums text-muted-foreground">{d.valueLabel ?? ""}</span>
            <motion.span className="block w-full rounded-lg" initial={{ height: 0 }} animate={{ height: seen ? Math.max(4, (d.value / peak) * (height - 36)) : 0, opacity: sel !== null && sel !== i ? 0.35 : 1 }} transition={{ delay: i * 0.07, type: "spring", stiffness: 160, damping: 20 }}
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
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      data-testid="finnos-donut"
      data-chart-interactive=""
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onSelect?.(null); }}
    >
      {seen ? <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="98%" paddingAngle={slices.length > 1 ? 2 : 0} cornerRadius={small ? 4 : 6} strokeWidth={0}
            isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
            onClick={(_, i) => { const s = slices[i]; if (s) onSelect?.(selected?.id === s.id ? null : s.id); }}>
            {slices.map((s) => <Cell key={s.id} fill={s.color} opacity={selected && s.id !== selected.id ? 0.22 : 1} style={{ transition: "opacity 200ms ease", cursor: onSelect ? "pointer" : undefined, outline: "none" }} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer> : null}
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

const HEAT = [
  "var(--muted)",
  "color-mix(in srgb, var(--finnos-purple) 20%, var(--background))",
  "color-mix(in srgb, var(--finnos-purple) 38%, var(--background))",
  "color-mix(in srgb, var(--finnos-purple-live) 58%, var(--background))",
  "color-mix(in srgb, var(--finnos-violet) 78%, var(--finnos-purple))",
  "var(--finnos-purple-live)",
];
const WEEK_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEK_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Mapa de calor calendário (Comportamento): one square per day, the more spent the stronger the purple. Days still to
 * come are dashed. The squares light up in sequence when the chart comes into view; touch a day to read it (touch again
 * to go back), and "Ver o dia" opens it.
 */
export function Heatmap({ month, values, today, format, compact = false, onOpenDay, className }: {
  month: string; values: Record<string, number>; today: string; format: (v: number) => string;
  compact?: boolean; onOpenDay?: (date: string) => void; className?: string;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  const offset = new Date(y, m - 1, 1).getDay();
  const max = Math.max(0, ...Object.values(values));
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : v / max <= 0.2 ? 1 : v / max <= 0.4 ? 2 : v / max <= 0.65 ? 3 : v / max <= 0.85 ? 4 : 5);
  const days = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const selWeekday = sel ? new Date(`${sel}T12:00:00`).getDay() : 0;
  return (
    <div ref={ref} className={cn("relative", className)} data-chart-interactive="" data-testid="finnos-heatmap" onClick={(e) => e.stopPropagation()}>
      {!compact ? <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted-foreground">{WEEK_LETTERS.map((w, i) => <span key={i}>{w}</span>)}</div> : null}
      <div className={cn("grid grid-cols-7", compact ? "gap-1" : "gap-1.5")}>
        {Array.from({ length: offset }, (_, i) => <span key={`e${i}`} aria-hidden="true" />)}
        {days.map((date, i) => {
          const v = values[date] ?? 0;
          const future = date > today;
          const lv = future ? 0 : level(v);
          return (
            <motion.button key={date} type="button" aria-pressed={sel === date} aria-label={`${date.slice(8)}: ${future ? "ainda não chegou" : format(v)}`}
              initial={{ opacity: 0, scale: 0.6 }} animate={seen ? { opacity: sel && sel !== date ? 0.35 : 1, scale: sel === date ? 1.12 : 1 } : { opacity: 0, scale: 0.6 }}
              transition={{ delay: seen && !sel ? i * 0.012 : 0, duration: 0.25 }}
              onClick={() => setSel(sel === date ? null : date)}
              className={cn("relative aspect-square rounded-[6px] text-[10px] font-semibold tabular-nums", compact && "rounded-[4px]", lv >= 4 ? "text-white" : "text-muted-foreground", future && "border border-dashed border-border bg-transparent", date === today && "ring-2 ring-foreground/70 ring-offset-1 ring-offset-card")}
              style={future ? undefined : { backgroundColor: HEAT[lv] }}>
              {compact ? null : Number(date.slice(8))}
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {sel ? (
          <motion.div key={sel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className={cn("flex items-baseline justify-between gap-3 text-[13px]", compact ? "mt-1.5" : "mt-3")} data-testid="heatmap-pick">
            <span className="min-w-0 truncate"><b className="font-semibold">{WEEK_SHORT[selWeekday]} {sel.slice(8)}/{sel.slice(5, 7)}</b> · {sel > today ? "ainda não chegou" : (values[sel] ?? 0) > 0 ? format(values[sel] ?? 0) : "sem gastos"}</span>
            {onOpenDay && sel <= today ? <button type="button" onClick={() => onOpenDay(sel)} className="shrink-0 text-[12px] font-semibold text-primary">Ver o dia</button> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
