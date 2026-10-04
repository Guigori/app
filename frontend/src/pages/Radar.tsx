import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { fetchRadar } from "@/lib/data";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RadarSignal } from "@/types/finnos";

const LABEL = { risk: "Risco", deviation: "Desvio", information: "Informação", opportunity: "Oportunidade" } as const;
const COLOR = { risk: "#FB4A6B", deviation: "#FF9F2F", information: "#8C5BFF", opportunity: "#34D399" } as const;

function target(signal: RadarSignal) {
  if (signal.related_entity_type === "card" && signal.related_entity_id) return `/cartoes/${signal.related_entity_id}`;
  if (signal.related_entity_type === "category" && signal.related_entity_id) return `/fluxo?metric=despesas&category_id=${encodeURIComponent(signal.related_entity_id)}`;
  return "/fluxo";
}

export default function Radar() {
  const navigate = useNavigate();
  const { data, isPending } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });
  const items = data?.items ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-up">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card hover:bg-accent" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div><h1 className="font-heading text-2xl font-bold">Radar</h1><p className="text-sm text-muted-foreground">Sinais financeiros encontrados pelo FINNOS.</p></div>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {isPending ? <p className="p-6 text-sm text-muted-foreground">Analisando seus dados…</p> : null}
        {!isPending && items.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Tudo tranquilo no seu Radar por enquanto.</p> : null}
        {items.map((signal) => (
          <Link key={signal.id} to={target(signal)} className="flex items-center gap-4 border-t border-border/60 p-5 first:border-t-0 hover:bg-muted/30">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLOR[signal.type] }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOR[signal.type] }}>{LABEL[signal.type]}</span>
              <span className="mt-1 block font-semibold text-foreground">{signal.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{signal.description}</span>
            </span>
            {signal.metric ? <span className="shrink-0 text-sm font-bold" style={{ color: COLOR[signal.type] }}>{signal.metric}</span> : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
