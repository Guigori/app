import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

import type { RadarSignal, RadarSignalType } from "@/types/finnos";

const SIGNAL_COLORS: Record<RadarSignalType, string> = {
  risk: "#FB4A6B",
  deviation: "#FF9F2F",
  information: "#8C5BFF",
  opportunity: "#34D399",
};

const SIGNAL_LABELS: Record<RadarSignalType, string> = {
  risk: "Risco",
  deviation: "Desvio",
  information: "Informação",
  opportunity: "Oportunidade",
};

function RadarIcon({
  signal,
  size = 54,
}: {
  signal: RadarSignal;
  size?: number;
}) {
  const color = SIGNAL_COLORS[signal.type];
  const critical = signal.severity === "critical";
  const label = critical ? `${SIGNAL_LABELS[signal.type]} crítico` : SIGNAL_LABELS[signal.type];

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden="true">
        <circle cx="28" cy="28" r="20" fill="none" stroke="currentColor" strokeWidth="7" className="text-primary/16" />
        <circle cx="28" cy="28" r="8" fill={critical ? color : "currentColor"} className={critical ? undefined : "text-primary/20"} />
        <g transform={`rotate(${signal.radar_position} 28 28)`}>
          <path d="M28 28 L28 5 A23 23 0 0 1 45.7 13.3 Z" fill={color} />
        </g>
      </svg>
    </span>
  );
}

function RadarSignalItem({ signal }: { signal: RadarSignal }) {
  const navigate = useNavigate();
  const color = SIGNAL_COLORS[signal.type];

  return (
    <button
      type="button"
      onClick={() => navigate(`/radar/${signal.id}`)}
      className="group flex w-full min-w-0 items-center gap-3 border-t border-border/60 py-3 text-left transition-colors first:border-t-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:gap-4"
      data-testid={`radar-signal-${signal.id}`}
    >
      <RadarIcon signal={signal} size={52} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-foreground sm:text-base">{signal.title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground sm:text-sm">{signal.description}</span>
      </span>
      {signal.metric ? (
        <span className="shrink-0 text-sm font-bold sm:text-base" style={{ color }}>
          {signal.metric}
        </span>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

export function RadarSection({
  signals,
  totalCount,
}: {
  signals: RadarSignal[];
  totalCount?: number;
}) {
  const navigate = useNavigate();
  const visibleSignals = signals.slice(0, 5);

  return (
    <section
      className="overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm"
      aria-labelledby="radar-title"
      data-testid="radar-section"
    >
      <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5 sm:px-6 sm:pt-6">
        <div>
          <h2 id="radar-title" className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Radar
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {totalCount ?? signals.length} {(totalCount ?? signals.length) === 1 ? "sinal para você" : "sinais para você"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/radar")}
          className={cn(
            "inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary transition-colors",
            "hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          data-testid="radar-view-all"
        >
          Ver todos
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 pb-2 sm:px-5 sm:pb-3">
        {visibleSignals.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">Tudo tranquilo no seu Radar por enquanto.</p>
        ) : null}
        {visibleSignals.map((signal) => (
          <RadarSignalItem key={signal.id} signal={signal} />
        ))}
      </div>
    </section>
  );
}
