/** Descobertas FINNOS: the library picks what matters now and shows it with a small chart and one sentence. */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
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
    const onScroll = () => { const el = track.current; if (el) setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); };
    return (
      <section className={cn("@container flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-primary/25 bg-card p-4 shadow-sm", className)} data-testid="discoveries-insight">
        <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {head}
          <span className="flex gap-1" aria-label={`${page + 1} de ${list.length}`}>{list.map((_, i) => <span key={i} className={cn("h-1.5 rounded-full transition-all", i === page ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30")} />)}</span>
        </div>
        <div ref={track} onScroll={onScroll} className="-mx-4 mt-2 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ touchAction: "pan-x pan-y" }}>
          {list.map((d) => (
            <div key={d.id} className="flex w-full shrink-0 snap-center px-4">
              <div className={cn("flex min-w-0 flex-1 gap-3", side(d.chart) ? "items-center" : "flex-col")}>
                <button type="button" onClick={() => open(d)} className="min-w-0 flex-1 text-left" data-testid={`discovery-${d.id}`}>
                  <span className="flex items-center gap-1.5 font-heading text-[15px] font-semibold"><span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[d.tone])} /><span className="truncate">{d.title}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></span>
                  <span className="mt-1 line-clamp-3 block text-[13px] leading-snug text-muted-foreground">{d.text}</span>
                </button>
                {hidden ? null : <div className={side(d.chart) ? "shrink-0" : "mt-auto"}><MiniChart chart={d.chart} size="M" money={ctx.money} /></div>}
              </div>
            </div>
          ))}
        </div>
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
