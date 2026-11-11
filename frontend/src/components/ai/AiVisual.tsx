/** What an answer shows besides the text, always with the Gráficos FINNOS (the same charts as the analyses). */
import { useState } from "react";
import { motion } from "motion/react";
import { Bars, Donut, FINNOS_COLOR, ProjectionLine } from "@/components/charts/FinnosCharts";
import { ChartView } from "@/components/insights/CatalogInsight";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FinnVisual } from "@/lib/aiConversations";

const PALETTE = ["var(--finnos-purple)", "var(--finnos-violet)", "var(--finnos-lilac)", "#0EA5E9", "#14B8A6", "#F59E0B", "#EC4899", "var(--finnos-app)"];
const short = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toLocaleString("pt-BR", { maximumFractionDigits: a >= 10000 ? 0 : 1 })} mil` : Math.round(a).toLocaleString("pt-BR");
  return `${v < 0 ? "−" : ""}${s}`;
};

/** Ranking (Comparação, horizontal): bars grow in, a tap highlights one and fades the others. */
function RankBars({ data, money, prefix }: { data: { name: string; value: number }[]; money: (v: number) => string; prefix?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <ul className="space-y-2.5" data-testid="ai-hbar-chart" data-chart-interactive="">
      {data.map((d, i) => (
        <li key={d.name + i}>
          <button type="button" onClick={() => setSel(sel === i ? null : i)} aria-pressed={sel === i} className={cn("w-full text-left transition-opacity", sel !== null && sel !== i && "opacity-45")}>
            <span className="flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate font-medium">{d.name}</span><span className="shrink-0 font-semibold tabular-nums">{prefix ?? ""}{money(d.value)}</span></span>
            <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-muted">
              <motion.span className="block h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.max(4, (Math.abs(d.value) / max) * 100)}%` }} transition={{ delay: i * 0.06, type: "spring", stiffness: 200, damping: 24 }}
                style={{ backgroundColor: i === 0 || sel === i ? FINNOS_COLOR.result : "color-mix(in srgb, var(--finnos-purple) 45%, var(--background))" }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DonutWithLegend({ data, money }: { data: { name: string; value: number }[]; money: (v: number) => string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const slices = data.map((d, i) => ({ id: d.name, name: d.name, value: d.value, color: PALETTE[i % PALETTE.length] }));
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex items-center gap-4">
      <Donut slices={slices} size={150} selectedId={picked} onSelect={setPicked} format={money} />
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.slice(0, 6).map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setPicked(picked === s.id ? null : s.id)} className={cn("flex w-full items-center gap-2 text-left text-xs transition-opacity", picked && picked !== s.id && "opacity-45")}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-right tabular-nums"><span className="block font-semibold">{money(s.value)}</span><span className="block text-[11px] text-muted-foreground">{Math.round((s.value / total) * 100)}%</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiVisual({ visual }: { visual: FinnVisual }) {
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const chart = visual.chart;
  const hasChart = Boolean(visual.finnos || chart);
  // A bullet chart or a donut with its legend already lists each row: no table repeating it.
  const items = visual.finnos?.type === "bullets" || chart?.type === "donut" ? undefined : visual.items;
  return (
    <div className="mt-3 space-y-3" data-testid="ai-visual">
      {visual.title ? <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{visual.title}</p> : null}
      {visual.metrics?.length ? (
        <div className={cn("grid gap-2", visual.metrics.length === 1 ? "grid-cols-1" : visual.metrics.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {visual.metrics.map((x) => (
            <div key={x.label} className="rounded-2xl bg-muted/60 px-3 py-2.5">
              <p className="truncate text-[11px] text-muted-foreground">{x.label}</p>
              <p className={cn("mt-0.5 truncate font-heading text-[15px] font-semibold tabular-nums", x.tone === "positive" && "text-income", x.tone === "negative" && "text-expense")}>{x.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      {hasChart && !hidden ? (
        <div className="rounded-2xl border border-border bg-background/60 p-3" data-testid="ai-chart">
          {visual.finnos ? <ChartView chart={visual.finnos} size="L" money={money} /> : null}
          {chart?.type === "bar" ? (
            <div data-testid="ai-bar-chart"><Bars height={150} format={money} data={chart.data.map((d, i, all) => ({ label: d.name, value: d.value, focus: i === all.length - 1, valueLabel: short(d.value) }))} /></div>
          ) : null}
          {chart?.type === "line" ? (
            <ProjectionLine area height={120} format={money} points={chart.data.map((d) => ({ value: d.value, kind: "real" as const, label: d.name }))} />
          ) : null}
          {chart?.type === "hbar" ? <RankBars data={chart.data} money={money} prefix={chart.prefix ?? "+"} /> : null}
          {chart?.type === "donut" ? <DonutWithLegend data={chart.data} money={money} /> : null}
        </div>
      ) : null}
      {items?.length ? (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border">
          {items.map((x, i) => (
            <li key={x.label + i} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0"><p className="truncate text-[13px] font-medium">{x.label}</p>{x.detail ? <p className="truncate text-xs text-muted-foreground">{x.detail}</p> : null}</div>
              <strong className="shrink-0 text-[13px] tabular-nums">{x.value}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
