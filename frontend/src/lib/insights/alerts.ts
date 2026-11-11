/**
 * Avisos dos widgets: when an analysis of the library turns critical, it becomes a notice that opens its own page.
 * Each notice id carries the state that made it (card + due date, first negative day, month), so a dismissed notice
 * comes back only when the situation is a new one.
 */
import type { NextInvoice } from "@/lib/insights/upcoming";
import type { BalanceForecast } from "@/lib/insights/forecast";
import { detailPath } from "@/lib/insights/registry";
import { formatBRL } from "@/lib/format";

export interface WidgetAlert {
  id: string;
  insight: string;
  title: string;
  description: string;
  target: string;
  critical: boolean;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function widgetAlerts(input: {
  invoices?: NextInvoice[];
  forecast?: BalanceForecast | null;
  budget?: { month: string; planned: number; spent: number } | null;
  today: string;
}): WidgetAlert[] {
  const out: WidgetAlert[] = [];
  for (const inv of input.invoices ?? []) {
    if (inv.amount <= 0) continue;
    if (inv.days < 0) {
      out.push({
        id: `fatura-atrasada:${inv.cardId}:${inv.due}`, insight: "fatura-que-vem", critical: true,
        title: `Fatura ${inv.cardName} venceu`,
        description: `${formatBRL(inv.amount)} venceu em ${ddmm(inv.due)} e ainda não foi paga.`,
        target: detailPath("fatura-que-vem", { cardId: inv.cardId }),
      });
    } else if (inv.covers === false && inv.days <= 10) {
      out.push({
        id: `fatura-sem-saldo:${inv.cardId}:${inv.due}`, insight: "fatura-que-vem", critical: true,
        title: `Sem saldo para a fatura ${inv.cardName}`,
        description: `Vence ${ddmm(inv.due)}: ${formatBRL(inv.amount)}${inv.accountName ? ` e ${inv.accountName} tem ${formatBRL(inv.balanceBefore ?? 0)}` : ""}. Faltam ${formatBRL(inv.shortfall)}.`,
        target: detailPath("fatura-que-vem", { cardId: inv.cardId }),
      });
    }
  }
  const f = input.forecast;
  if (f?.firstNegative) {
    const date = f.firstNegative;
    out.push({
      id: `saldo-negativo:${date}`, insight: "previsao-saldo", critical: true,
      title: date <= input.today ? "Saldo negativo" : `Saldo fica negativo em ${ddmm(date)}`,
      description: `A estimativa chega a ${formatBRL(f.lowest?.value ?? 0)}${f.lowest && f.lowest.date !== date ? ` em ${ddmm(f.lowest.date)}` : ""}. Veja o que entra e o que sai até lá.`,
      target: detailPath("previsao-saldo", {}),
    });
  }
  const b = input.budget;
  if (b && b.planned > 0 && b.spent > b.planned) {
    out.push({
      id: `orcamento-estourado:${b.month}`, insight: "orcamento", critical: false,
      title: "Orçamento do mês passou do limite",
      description: `${formatBRL(b.spent)} gastos de ${formatBRL(b.planned)} planejados: ${formatBRL(b.spent - b.planned)} acima.`,
      target: detailPath("orcamento", {}),
    });
  }
  return out;
}
