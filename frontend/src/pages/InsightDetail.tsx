/** An analysis of the library on its own page (where a widget leads): the full analysis, how it is made,
 *  questions for FINNOS IA with its context, the filtered screen, and placing it in Início or Análise. */
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ScreenHeader } from "@/components/layout/BackButton";
import { toast } from "sonner";
import { ArrowRight, Check, Pin, Plus, Sparkles } from "lucide-react";
import { insightById, type WidgetConfig } from "@/lib/insights/registry";
import { newKey, readLayouts, saveLayout, useLayout, type Surface } from "@/lib/insights/layout";
import { cn } from "@/lib/utils";
import { InsightWidget } from "@/components/insights/widgets";
import { LABEL } from "@/components/insights/InsightShell";
import { useCards } from "@/components/insights/useInsightData";

export default function InsightDetail() {
  const { insightId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const def = insightById(insightId);
  const cards = useCards();
  const home = useLayout("inicio");
  const pinned = useLayout("analise");
  if (!def) return <Navigate to="/analise" replace />;
  const config: WidgetConfig = def.cardScope ? { cardId: params.get("cartao") } : {};
  // One place per thing: an analysis that lives on another screen opens that screen.
  if (def.canonical) return <Navigate to={def.canonical(config)} replace />;
  const cardName = config.cardId ? cards.data?.find((c) => c.id === config.cardId)?.name : null;
  const scope = def.cardScope ? (cardName ?? "Todos os cartões") : null;

  const ask = (question: string) => window.dispatchEvent(new CustomEvent("finnos-ai-open", {
    detail: {
      question,
      context: { analise: def.title, recorte: scope ?? "mês atual", como_e_calculado: def.how, tela: `/analise/painel/${def.id}` },
    },
  }));
  const has = (list: typeof home) => list.some((w) => w.id === def.id && (w.config?.cardId ?? null) === (config.cardId ?? null));
  const place = (surface: Surface) => {
    const current = readLayouts()[surface];
    saveLayout(surface, [...current, { key: newKey(), id: def.id, size: def.defaultSize, config: def.cardScope ? config : undefined }]);
    toast.success(surface === "inicio" ? "Adicionada ao Início." : "Fixada na Análise.");
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-32 animate-fade-up" data-testid="insight-detail">
      <ScreenHeader eyebrow={def.theme} title={def.title} />
      <p className="-mt-2 text-sm text-muted-foreground">{def.description}</p>

      {def.cardScope && cards.data?.some((c) => c.active) ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Qual cartão">
          {[{ id: null as string | null, name: "Todos" }, ...cards.data.filter((c) => c.active)].map((c) => (
            <button key={c.id ?? "todos"} type="button" aria-pressed={(config.cardId ?? null) === c.id}
              onClick={() => { const next = new URLSearchParams(params); if (c.id) next.set("cartao", c.id); else next.delete("cartao"); setParams(next, { replace: true }); }}
              className={cn("h-9 shrink-0 rounded-full border px-4 text-sm font-semibold", (config.cardId ?? null) === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>{c.name}</button>
          ))}
        </div>
      ) : null}

      <InsightWidget id={def.id} size="XL" config={config} />

      <Link to={def.to(config)} className="flex h-12 items-center justify-between rounded-full border border-border bg-card px-5 text-sm font-semibold" data-testid="insight-detail-source">
        {def.toLabel}<ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </Link>

      <section className="rounded-3xl border border-border/80 bg-card p-5 shadow-sm">
        <p className={LABEL}>Como é calculado</p>
        <p className="mt-2 text-sm leading-relaxed">{def.how}</p>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card p-5 shadow-sm" data-testid="insight-detail-ai">
        <p className={LABEL}>Converse com o FINNOS IA</p>
        <p className="mt-2 text-sm text-muted-foreground">Ele abre sabendo qual é esta análise{scope ? ` (${scope})` : ""} e como ela é feita.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {def.questions.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-border px-3.5 py-2 text-left text-sm hover:bg-muted">{q}</button>
          ))}
        </div>
        <button type="button" onClick={() => ask(`Me explique a análise "${def.title}"${scope ? ` de ${scope}` : ""} com os meus números.`)} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground" data-testid="insight-detail-ask">
          <Sparkles className="size-4" aria-hidden="true" />Perguntar sobre esta análise
        </button>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={has(home)} onClick={() => place("inicio")} className="flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card text-sm font-semibold disabled:text-muted-foreground">
          {has(home) ? <Check className="size-4" /> : <Plus className="size-4" />}{has(home) ? "Já está no Início" : "Adicionar ao Início"}
        </button>
        <button type="button" disabled={has(pinned)} onClick={() => place("analise")} className="flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card text-sm font-semibold disabled:text-muted-foreground">
          {has(pinned) ? <Check className="size-4" /> : <Pin className="size-4" />}{has(pinned) ? "Fixada na Análise" : "Fixar na Análise"}
        </button>
      </div>
    </div>
  );
}
