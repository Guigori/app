/** Descobertas FINNOS: the library picks what matters now and shows it with a small chart and one sentence. */
import { useRef, useState, type TouchEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useBalanceHidden } from "@/lib/balance";
import { DISCOVERY_NEEDS, discoveries, type Discovery } from "@/lib/insights/discoveries";
import { detailPath, type WidgetSize } from "@/lib/insights/registry";
import type { Chart } from "@/lib/insights/catalog";
import { cn } from "@/lib/utils";
import { ChartView, useCatalogCtx } from "@/components/insights/CatalogInsight";
import { InsightShell, NOTE, Tile } from "@/components/insights/InsightShell";

const TONE_DOT: Record<Discovery["tone"], string> = { bad: "bg-expense", good: "bg-income", info: "bg-primary" };

/** A small chart that fits a discovery: rings beside the text, bars and lines below (one bullet only in M). */
function MiniChart({ chart, size, money }: { chart?: Chart; size: WidgetSize; money: (v: number) => string }) {
  if (!chart) return null;
  const c = chart.type === "bullets" ? { ...chart, items: chart.items.slice(0, 1) } : chart;
  if (size === "M" && chart.type === "bars") return null;
  return <ChartView chart={c} size={size === "M" ? "M" : "L"} money={money} />;
}
const side = (c?: Chart) => c && (c.type === "gauge" || c.type === "donut");

export function DiscoveriesInsight({ size, to, className }: { size: WidgetSize; to?: string; className?: string }) {
  const ctx = useCatalogCtx(DISCOVERY_NEEDS);
  const { hidden } = useBalanceHidden();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  if (!ctx) return <div className={cn("h-full min-h-40 animate-pulse rounded-3xl bg-muted", className)} />;
  const list = discoveries(ctx, size === "XL" ? 12 : 6);
  const open = (d: Discovery) => navigate(detailPath(d.id));
  const head = (
    <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-primary" aria-hidden="true" />Descobertas FINNOS</span>
  );
  if (!list.length) return (
    <Tile title="Descobertas FINNOS" className={className} testId="discoveries-insight">
      <p className={cn(NOTE, "mt-auto")}>Ainda não há nada que chame atenção. Conforme você registra o mês, as descobertas aparecem aqui.</p>
    </Tile>
  );

  if (size === "S") {
    const d = list[0];
    return (
      <Tile title="Descoberta" className={className} testId="discoveries-insight">
        <button type="button" onClick={() => open(d)} className="flex min-h-0 flex-1 flex-col text-left">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold"><span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[d.tone])} />{d.title}</span>
          <span className="mt-1 line-clamp-4 text-[13px] leading-snug text-muted-foreground">{d.text}</span>
        </button>
      </Tile>
    );
  }

  if (size === "M") {
    // A track moved by the page index: arrows, dots and a swipe all change the same page (a native
    // horizontal scroll inside the board fought the board's own gestures on iPhone and did not move).
    const last = list.length - 1;
    const at = Math.min(page, last);
    const go = (i: number) => setPage(Math.max(0, Math.min(last, i)));
    const onTouchStart = (e: TouchEvent) => { moved.current = false; swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTouchEnd = (e: TouchEvent) => {
      const s0 = swipe.current; swipe.current = null; if (!s0) return;
      const dx = e.changedTouches[0].clientX - s0.x, dy = e.changedTouches[0].clientY - s0.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { moved.current = true; go(at + (dx < 0 ? 1 : -1)); }
    };
    const arrow = "grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground transition disabled:opacity-30";
    return (
      <section className={cn("@container flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-primary/25 bg-card p-4 shadow-sm", className)} data-testid="discoveries-insight">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {head}
          {list.length > 1 ? (
            <span className="flex items-center gap-1.5 normal-case tracking-normal">
              <button type="button" className={arrow} onClick={() => go(at - 1)} disabled={at === 0} aria-label="Descoberta anterior" data-testid="discoveries-prev"><ChevronLeft className="size-4" aria-hidden="true" /></button>
              <span className="text-xs tabular-nums" aria-live="polite">{at + 1}/{list.length}</span>
              <button type="button" className={arrow} onClick={() => go(at + 1)} disabled={at === last} aria-label="Próxima descoberta" data-testid="discoveries-next"><ChevronRight className="size-4" aria-hidden="true" /></button>
            </span>
          ) : null}
        </div>
        <div className="-mx-4 mt-2 min-h-0 flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ touchAction: "pan-y" }}>
          <div ref={track} className="flex h-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${at * 100}%)` }}>
            {list.map((d, i) => (
              <div key={d.id} className="flex w-full shrink-0 px-4" aria-hidden={i !== at}>
                <div className={cn("flex min-w-0 flex-1 gap-3", side(d.chart) ? "items-center" : "flex-col")}>
                  <button type="button" tabIndex={i === at ? 0 : -1} onClick={() => { if (moved.current) { moved.current = false; return; } open(d); }} className="min-w-0 flex-1 text-left" data-testid={`discovery-${d.id}`}>
                    <span className="flex items-center gap-1.5 font-heading text-[15px] font-semibold"><span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[d.tone])} /><span className="truncate">{d.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></span>
                    <span className="mt-1 line-clamp-3 block text-[13px] leading-snug text-muted-foreground">{d.text}</span>
                  </button>
                  {hidden ? null : <div className={side(d.chart) ? "shrink-0" : "mt-auto"}><MiniChart chart={d.chart} size="M" money={ctx.money} /></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {list.length > 1 ? (
          <div className="mt-2 flex justify-center gap-1" role="tablist" aria-label="Descobertas">
            {list.map((d, i) => <button key={d.id} type="button" role="tab" aria-selected={i === at} aria-label={`Descoberta ${i + 1}`} onClick={() => go(i)} className="grid h-5 place-items-center px-0.5"><span className={cn("block h-1.5 rounded-full transition-all", i === at ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30")} /></button>)}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <InsightShell title="Descobertas FINNOS" subtitle="O que mudou ou chama atenção agora" to={to} className={className} testId="discoveries-insight">
      <ul className="space-y-3">
        {list.slice(0, size === "XL" ? 12 : 3).map((d) => (
          <li key={d.id} className="rounded-2xl border border-border/70 p-4">
            <div className={cn("flex gap-4", side(d.chart) ? "items-center" : "flex-col")}>
              <button type="button" onClick={() => open(d)} className="min-w-0 flex-1 text-left" data-testid={`discovery-${d.id}`}>
                <span className="flex items-center gap-1.5 font-heading text-[15px] font-semibold"><span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[d.tone])} />{d.title}<ChevronRight className="ml-auto size-4 text-muted-foreground" /></span>
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{d.text}</span>
              </button>
              {hidden || !d.chart ? null : <div className={side(d.chart) ? "shrink-0" : ""}><MiniChart chart={d.chart} size={size === "XL" ? "L" : "M"} money={ctx.money} /></div>}
            </div>
          </li>
        ))}
      </ul>
      {size !== "XL" && list.length > 3 ? <p className={cn(NOTE, "mt-3")}>+{list.length - 3} na página das descobertas</p> : null}
    </InsightShell>
  );
}
