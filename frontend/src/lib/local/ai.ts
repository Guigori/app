import { currentMonth } from "@/lib/format";
import { localBudget, localDashboard, localListTransactions } from "@/lib/local/engine";
import { getMode } from "@/lib/mode";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export async function askLocalFinnos(question: string, month?: string): Promise<string> {
  const m = month ?? currentMonth();
  const dashboard = localDashboard(m);
  const budget = localBudget(m);
  const txs = localListTransactions({ month: m });
  const q = question.toLocaleLowerCase("pt-BR");
  const demo = getMode() === "demo";
  const prefix = demo ? "Na demonstração, " : "";

  if (q.includes("radar") || q.includes("atenção") || q.includes("atencao")) {
    const top = dashboard.categories[0];
    const over = dashboard.rule.filter((r) => r.percent > 100);
    if (!top && !over.length) return `${prefix}não encontrei um sinal crítico com os dados atuais. Continue acompanhando orçamento e vencimentos.`;
    return `${prefix}eu destacaria ${over.length ? over.map((r) => r.label).join(" e ") + " acima do limite 50/30/20" : "o peso de " + top?.name + " nas despesas"}. Posso detalhar esse ponto e montar um plano de ação.`;
  }
  if (q.includes("econom") || q.includes("cortar") || q.includes("plano de ação") || q.includes("plano de acao")) {
    const top = dashboard.categories.slice(0, 3);
    if (!top.length) return `${prefix}ainda preciso de mais despesas categorizadas para sugerir onde economizar.`;
    return `${prefix}eu começaria pelas categorias de maior peso: ${top.map((x) => `${x.name}: 10% representa cerca de ${money(x.total * 0.1)}/mês`).join("; ")}. Isso é uma simulação para ajudar no planejamento.`;
  }
  if (q.includes("quanto gastei") || q.includes("despesa")) {
    return `${prefix}suas despesas em ${m} somam ${money(dashboard.expense)}. A receita do período é ${money(dashboard.income)}, deixando um saldo mensal de ${money(dashboard.month_balance)}.`;
  }
  if (q.includes("categoria") || q.includes("gastando mais") || q.includes("onde")) {
    const top = dashboard.categories[0];
    if (!top) return `${prefix}ainda não há despesas categorizadas neste mês.`;
    return `${prefix}a categoria com maior gasto é ${top.name}: ${money(top.total)} (${top.percent}% das despesas do mês).`;
  }
  if (q.includes("50/30/20") || q.includes("regra")) {
    const parts = dashboard.rule.map((r) => `${r.label}: ${money(r.spent)} de ${money(r.limit)} (${Math.round(r.percent)}%)`);
    return `${prefix}sua regra 50/30/20 está assim: ${parts.join("; ")}.`;
  }
  if (q.includes("quanto ainda") || q.includes("posso gastar") || q.includes("orçamento")) {
    return `${prefix}o orçamento planejado é ${money(budget.planned)}; você já utilizou ${money(budget.spent)} e tem ${money(Math.max(0, budget.remaining))} restantes nas categorias orçadas.`;
  }
  if (q.includes("vence") || q.includes("vencimento") || q.includes("próxim") || q.includes("proxim")) {
    const pending = txs.filter((t) => t.status === "pendente" || t.status === "agendado").slice(0, 5);
    if (!pending.length) return `${prefix}não encontrei contas pendentes ou agendadas neste mês.`;
    return `${prefix}encontrei: ${pending.map((t) => `${t.name} — ${money(t.value)} em ${t.date.split("-").reverse().join("/")}`).join("; ")}.`;
  }

  const top = dashboard.categories[0];
  const over = dashboard.rule.filter((r) => r.percent > 100);
  const insight = over.length
    ? ` Atenção: ${over.map((r) => r.label).join(" e ")} ${over.length > 1 ? "estão" : "está"} acima do limite 50/30/20.`
    : "";
  return `${prefix}seu saldo total é ${money(dashboard.total_balance)}. Neste mês entraram ${money(dashboard.income)} e saíram ${money(dashboard.expense)}, com resultado de ${money(dashboard.month_balance)}.${top ? ` Seu maior gasto está em ${top.name} (${money(top.total)}).` : ""}${insight} Posso detalhar despesas, categorias, orçamento, 50/30/20 ou vencimentos.`;
}
