/**
 * Análise: the person's own board of the analysis library, exactly like Início — every block here is an analysis
 * that can be moved, resized, removed or added from the gallery. Each one opens its full page (or its one home,
 * e.g. categories in Fluxo), so nothing is repeated on two screens.
 */
import { WidgetBoard } from "@/components/insights/WidgetBoard";
import { currentMonth, monthLabel } from "@/lib/format";

export default function Analysis() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up" data-testid="analysis-page">
      <WidgetBoard
        surface="analise"
        header={
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Análise</h1>
            <p className="text-sm text-muted-foreground">{monthLabel(currentMonth())} · toque numa análise para ver tudo dela</p>
          </div>
        }
        emptyText="Adicione aqui as análises que você quer acompanhar."
      />
    </div>
  );
}
