/** The FINNOS analysis library: every analysis that can be placed in Início and Análise, its sizes and where a tap leads. */
import { currentMonth } from "@/lib/format";

/** Widget sizes. "XL" is no longer offered: the full analysis opens on its own page (`detailPath`). */
export type WidgetSize = "S" | "M" | "L" | "XL";
export const SIZE_LABEL: Record<WidgetSize, string> = { S: "Pequeno", M: "Médio", L: "Grande", XL: "Grande" };
export const SIZE_ORDER: WidgetSize[] = ["S", "M", "L"];

export type InsightTheme = "Cartões" | "Compromissos" | "Orçamento" | "Renda" | "Gastos" | "Metas" | "Alertas";
export const THEMES: InsightTheme[] = ["Orçamento", "Renda", "Compromissos", "Cartões", "Gastos", "Metas", "Alertas"];

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
  /** The screen with the same data, filtered (Fluxo, Cartões…): the analysis page links to it. */
  to: (config: WidgetConfig) => string;
  /** What the "Ver no…" button says. */
  toLabel: string;
  /** How the number is made, in plain words (shown on the analysis page). */
  how: string;
  /** Ready questions for FINNOS IA about this analysis. */
  questions: string[];
  /** Lets the person pick a card for it. */
  cardScope?: boolean;
  star?: boolean;
}

export const INSIGHTS: InsightDef[] = [
  { id: "gastar-hoje", title: "Quanto posso gastar hoje", description: "O que sobra do mês por dia, depois do que já saiu e do que está agendado.", theme: "Orçamento", sizes: ["S", "M", "L"], defaultSize: "M", to: () => "/orcamento", toLabel: "Ver orçamento", star: true,
    how: "Pegamos o orçamento do mês (ou a renda, se não houver orçamento), tiramos o que já saiu e o que está agendado até o fim do mês e dividimos pelos dias que faltam, contando hoje.",
    questions: ["Por que hoje passei do ritmo?", "Onde posso cortar para fechar o mês?", "Como fica se eu gastar R$ 100 hoje?"] },
  { id: "orcamento", title: "Orçamento do mês", description: "Quanto do orçamento já foi, o que sobra e quais categorias passaram do limite.", theme: "Orçamento", sizes: ["S", "M", "L"], defaultSize: "M", to: () => "/orcamento", toLabel: "Ver orçamento",
    how: "Somamos o que foi gasto no mês em cada categoria com limite e comparamos com o limite dela. O total é a soma dos limites; o ritmo compara o que você gastou até hoje com o mesmo dia do mês passado.",
    questions: ["Em que categoria devo segurar os gastos?", "Meu orçamento está realista?", "Como fecho o mês dentro do orçamento?"] },
  { id: "metas", title: "Metas", description: "Quanto já foi guardado em cada meta, se está no ritmo e quanto falta por mês.", theme: "Metas", sizes: ["S", "M", "L"], defaultSize: "M", to: () => "/patrimonio", toLabel: "Ver metas",
    how: "Para cada meta usamos o valor guardado (ou o saldo da conta ligada a ela) e comparamos com o plano: o que já deveria estar guardado até hoje. O valor por mês é o que falta dividido pelos meses até o prazo.",
    questions: ["Qual meta devo priorizar?", "Como chego mais rápido na minha meta?", "Quanto posso guardar por mês?"] },
  { id: "previsao-saldo", title: "Estimativa de saldo", description: "Saldo das contas até hoje e a estimativa até o fim do mês, com o dia mais apertado.", theme: "Renda", sizes: ["S", "M", "L"], defaultSize: "L", to: () => `/transacoes?aba=caixa&month=${currentMonth()}&metric=caixa`, toLabel: "Ver no Caixa", star: true,
    how: "Até hoje é o saldo real das contas. Daqui para frente somamos as entradas agendadas e tiramos as contas agendadas, as faturas que vencem no mês e as assinaturas fora do cartão. Compras no cartão só saem da conta quando a fatura é paga.",
    questions: ["Por que o saldo cai nesse dia?", "Vou conseguir pagar tudo este mês?", "Quanto posso guardar este mês?"] },
  { id: "semana-que-vem", title: "Semana que vem", description: "Contas, faturas e assinaturas dos próximos 7 dias.", theme: "Compromissos", sizes: ["S", "M", "L"], defaultSize: "M", to: () => `/transacoes?month=${currentMonth()}&fixas=1`, toLabel: "Ver no calendário", star: true,
    how: "Juntamos o que vence de hoje até daqui a 6 dias: contas agendadas na conta, faturas de cartão e assinaturas cobradas fora do cartão. Compras no cartão ficam dentro da fatura e não aparecem soltas.",
    questions: ["Tenho saldo para a semana?", "O que posso adiar?", "Qual conta pesa mais?"] },
  { id: "fatura-que-vem", title: "Fatura que vem", description: "Quanto você paga no próximo vencimento e se o saldo da conta cobre.", theme: "Cartões", sizes: ["S", "M", "L"], defaultSize: "S", requires: "cards", to: (c) => (c.cardId ? `/cartoes/${c.cardId}` : "/contas?aba=cartoes"), toLabel: "Ver cartões", star: true,
    how: "Para cada cartão usamos a fatura fechada que ainda falta pagar ou, se não houver, a fatura aberta. Comparamos com o saldo da conta que paga, descontando as faturas que vencem antes dela na mesma conta.",
    questions: ["Como pagar essa fatura sem apertar o mês?", "Por que a fatura veio maior?", "Vale pagar antes do vencimento?"] },
  { id: "contas-fixas", title: "Contas fixas", description: "Pagas, a pagar e atrasadas no mês; pague com um toque.", theme: "Compromissos", sizes: ["S", "M", "L"], defaultSize: "M", to: () => `/transacoes?month=${currentMonth()}&fixas=1`, toLabel: "Ver no calendário",
    how: "Contas marcadas como fixas ou recorrentes no mês. Pagas são as já marcadas como pagas; atrasadas, as que passaram da data sem pagamento.",
    questions: ["Quais contas fixas mais subiram?", "Quanto das minhas despesas é fixo?", "O que acontece se eu atrasar?"] },
  { id: "faturas", title: "Faturas", description: "Fatura passada, atual e as próximas, de um cartão ou de todos.", theme: "Cartões", sizes: ["S", "M", "L"], defaultSize: "L", requires: "cards", cardScope: true, to: (c) => (c.cardId ? `/cartoes/${c.cardId}` : "/contas?aba=cartoes"), toLabel: "Ver fatura",
    how: "Cada fatura segue o dia de fechamento do cartão: compra até o fechamento entra na fatura daquele mês, depois dele na seguinte. As próximas faturas são a estimativa com o que já está lançado (parcelas e compras).",
    questions: ["Por que a fatura subiu?", "O que mais pesa na fatura?", "Como fica a próxima fatura?"] },
  { id: "parcelas", title: "Parcelas em andamento", description: "Parcela de cada compra, quanto falta e o peso nos próximos meses.", theme: "Cartões", sizes: ["S", "M", "L"], defaultSize: "M", cardScope: true, to: () => "/contas?aba=cartoes", toLabel: "Ver cartões",
    how: "Parcelas no cartão seguem a fatura em que cada parcela cai. Mostramos a parcela da fatura aberta, quantas faltam e quanto do orçamento dos próximos meses elas já ocupam junto com as contas fixas.",
    questions: ["Quando sobra dinheiro das parcelas?", "Vale antecipar alguma parcela?", "Posso fazer uma compra parcelada agora?"] },
  { id: "categorias", title: "Gastos por categoria", description: "Para onde foi o dinheiro do mês, por categoria.", theme: "Gastos", sizes: ["S", "M", "L"], defaultSize: "L", to: () => `/transacoes?month=${currentMonth()}&metric=despesas`, toLabel: "Ver no Fluxo",
    how: "Despesas pagas do mês somadas por categoria. Compras no cartão contam no mês da compra; parcelas, uma por mês.",
    questions: ["Em que categoria estou gastando mais que o normal?", "Onde dá para economizar?", "Compare com o mês passado"] },
  { id: "radar", title: "Radar", description: "Os avisos do FINNOS que pedem atenção agora.", theme: "Alertas", sizes: ["S", "M", "L"], defaultSize: "M", to: () => "/radar", toLabel: "Ver Radar",
    how: "O Radar cruza orçamento, faturas, contas agendadas e o seu histórico e avisa o que foge do padrão ou pede ação.",
    questions: ["Qual aviso devo resolver primeiro?", "Por que esse aviso apareceu?", "Como evito isso no próximo mês?"] },
];

/** The analysis page of a widget (a tap on the widget opens it). */
export const detailPath = (id: string, config: WidgetConfig = {}) => `/analise/painel/${id}${config.cardId ? `?cartao=${encodeURIComponent(config.cardId)}` : ""}`;
export const insightById = (id: string) => INSIGHTS.find((i) => i.id === id);

/** The next size the analysis accepts (the handle in edit mode cycles through them). */
export function nextSize(def: InsightDef, size: WidgetSize): WidgetSize {
  const i = def.sizes.indexOf(size);
  return def.sizes[(i + 1) % def.sizes.length] ?? def.defaultSize;
}

/** Grid placement: 4 columns on the phone (Pequeno = half), 12 on the computer. */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  S: "col-span-2 dashboard:col-span-3 h-[11rem]",
  M: "col-span-4 dashboard:col-span-6 h-[11rem]",
  L: "col-span-4 dashboard:col-span-6 min-h-[23rem]",
  XL: "col-span-4 dashboard:col-span-6 min-h-[23rem]",
};
