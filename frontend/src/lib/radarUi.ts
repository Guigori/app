/** Shared presentation rules for Radar signals: labels, colors, order and where each one leads. */
import { currentMonth } from "@/lib/format";
import { AlertTriangle, Info, Lightbulb, TrendingUp, type LucideIcon } from "lucide-react";
import type { RadarSignal, RadarSignalType } from "@/types/finnos";

export const RADAR_TYPES: RadarSignalType[] = ["risk", "deviation", "opportunity", "information"];

export const RADAR_LABEL: Record<RadarSignalType, string> = { risk: "Risco", deviation: "Desvio", information: "Informação", opportunity: "Oportunidade" };
export const RADAR_PLURAL: Record<RadarSignalType, string> = { risk: "Riscos", deviation: "Desvios", information: "Informações", opportunity: "Oportunidades" };
export const RADAR_COLOR: Record<RadarSignalType, string> = {
  risk: "var(--signal-risk)",
  deviation: "var(--signal-deviation)",
  information: "var(--signal-information)",
  opportunity: "var(--signal-opportunity)",
};
export const RADAR_ICON: Record<RadarSignalType, LucideIcon> = { risk: AlertTriangle, deviation: TrendingUp, information: Info, opportunity: Lightbulb };

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, normal: 3 } as const;

/** Urgent first, then by score: the order the list is read in. */
export function sortSignals(items: RadarSignal[]): RadarSignal[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.score - a.score);
}

export function needsAttention(signal: RadarSignal): boolean {
  return signal.severity === "critical" || signal.severity === "high";
}

export function severityLabel(signal: RadarSignal): string | null {
  if (signal.severity === "critical") return "Urgente";
  if (signal.severity === "high") return "Importante";
  return null;
}

export function isRecurringCandidate(signal: RadarSignal): boolean {
  return signal.id.startsWith("recurring-") && signal.related_entity_type === "transaction" && Boolean(signal.related_entity_id);
}

/** Where a signal leads; `short` fits the chip on a list card, `label` the full button. */
export function radarTarget(signal: RadarSignal): { to: string; label: string; short: string } {
  if (signal.related_entity_type === "card" && signal.related_entity_id) return { to: `/cartoes/${signal.related_entity_id}`, label: "Abrir fatura", short: "Abrir fatura" };
  if (signal.related_entity_type === "category" && signal.related_entity_id) return { to: `/fluxo?month=${currentMonth()}&metric=despesas&category_id=${encodeURIComponent(signal.related_entity_id)}`, label: "Ver no fluxo de caixa", short: "Ver gastos" };
  if (isRecurringCandidate(signal)) return { to: "/assinaturas", label: "Ver assinaturas", short: "Ver assinaturas" };
  if (signal.related_entity_type === "cashflow") return { to: `/fluxo?month=${currentMonth()}&metric=projecao`, label: "Ver no fluxo de caixa", short: "Ver projeção" };
  return { to: `/fluxo?month=${currentMonth()}`, label: "Ver no fluxo de caixa", short: "Ver no fluxo" };
}
