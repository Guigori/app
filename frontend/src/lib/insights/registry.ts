/** The FINNOS analysis library: every analysis that can be placed in Início and Análise, its sizes and where a tap leads. */
import { currentMonth } from "@/lib/format";

export type WidgetSize = "S" | "M" | "L" | "XL";
export const SIZE_LABEL: Record<WidgetSize, string> = { S: "Pequeno", M: "Médio", L: "Grande", XL: "Extra grande" };
export const SIZE_ORDER: WidgetSize[] = ["S", "M", "L", "XL"];

export type InsightTheme = "Cartões" | "Compromissos" | "Orçamento" | "Renda" | "Gastos" | "Alertas";
export const THEMES: InsightTheme[] = ["Orçamento", "Renda", "Compromissos", "Cartões", "Gastos", "Alertas"];

export interface WidgetConfig { cardId?: string | null }

export interface InsightDef {
  id: string;
  title: string;
  description: string;
  theme: InsightTheme;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** Hidden from the gallery while the person has nothing for it (no card, for instance). */
  requires?: "cards";
  /** The analysis it comes from: a tap on the widget opens it, in the same scope. */
  to: (config: WidgetConfig) => string;
  /** Lets the person pick a card for it. */
  cardScope?: boolean;
  star?: boolean;
}

export const INSIGHTS: InsightDef[] = [
  { id: "gastar-hoje", title: "Quanto posso gastar hoje", description: "O que sobra do mês por dia, depois do que já saiu e do que está agendado.", theme: "Orçamento", sizes: ["S", "M", "L"], defaultSize: "M", to: () => "/orcamento", star: true },
  { id: "previsao-saldo", title: "Previsão de saldo", description: "Saldo das contas até hoje e o previsto até o fim do mês, com o dia mais apertado.", theme: "Renda", sizes: ["S", "M", "L", "XL"], defaultSize: "L", to: () => `/transacoes?aba=caixa&month=${currentMonth()}`, star: true },
  { id: "semana-que-vem", title: "Semana que vem", description: "Contas, faturas e assinaturas dos próximos 7 dias.", theme: "Compromissos", sizes: ["S", "M", "L"], defaultSize: "M", to: () => `/transacoes?month=${currentMonth()}&fixas=1`, star: true },
  { id: "fatura-que-vem", title: "Fatura que vem", description: "Quanto você paga no próximo vencimento e se o saldo da conta cobre.", theme: "Cartões", sizes: ["S", "M", "L"], defaultSize: "S", requires: "cards", to: (c) => (c.cardId ? `/cartoes/${c.cardId}` : "/contas?aba=cartoes"), star: true },
  { id: "contas-fixas", title: "Contas fixas", description: "Pagas, a pagar e atrasadas no mês; pague com um toque.", theme: "Compromissos", sizes: ["S", "M", "L", "XL"], defaultSize: "M", to: () => `/transacoes?month=${currentMonth()}&fixas=1` },
  { id: "faturas", title: "Faturas", description: "Fatura passada, atual e as próximas, de um cartão ou de todos.", theme: "Cartões", sizes: ["S", "M", "L", "XL"], defaultSize: "L", requires: "cards", cardScope: true, to: (c) => (c.cardId ? `/cartoes/${c.cardId}` : "/contas?aba=cartoes") },
  { id: "parcelas", title: "Parcelas em andamento", description: "Parcela de cada compra, quanto falta e o peso nos próximos meses.", theme: "Cartões", sizes: ["S", "M", "L", "XL"], defaultSize: "M", cardScope: true, to: () => "/contas?aba=cartoes" },
  { id: "categorias", title: "Gastos por categoria", description: "Para onde foi o dinheiro do mês, por categoria.", theme: "Gastos", sizes: ["L", "XL"], defaultSize: "L", to: () => `/transacoes?month=${currentMonth()}&metric=despesas` },
  { id: "radar", title: "Radar", description: "Os avisos do FINNOS que pedem atenção agora.", theme: "Alertas", sizes: ["L", "XL"], defaultSize: "L", to: () => "/radar" },
];

export const insightById = (id: string) => INSIGHTS.find((i) => i.id === id);

/** The next size the analysis accepts (the handle in edit mode cycles through them). */
export function nextSize(def: InsightDef, size: WidgetSize): WidgetSize {
  const i = def.sizes.indexOf(size);
  return def.sizes[(i + 1) % def.sizes.length] ?? def.defaultSize;
}

/** Grid placement: 4 columns on the phone (Pequeno = half), 12 on the computer. */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  S: "col-span-2 dashboard:col-span-3 h-[10.5rem]",
  M: "col-span-4 dashboard:col-span-6 h-[10.5rem]",
  L: "col-span-4 dashboard:col-span-6 min-h-[22rem]",
  XL: "col-span-4 dashboard:col-span-12",
};
