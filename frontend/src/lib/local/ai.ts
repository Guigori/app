import { currentMonth } from "@/lib/format";
import { localBudget, localDashboard, localListTransactions } from "@/lib/local/engine";
import { getMode } from "@/lib/mode";
import type { FinnMessage, FinnVisual } from "@/lib/aiConversations";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const monthLabel = (month: string) => {
  const [y,m]=month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));
};
export type LocalFinnAnswer = { text: string; visual?: FinnVisual };

function priorCategory(history: FinnMessage[], categories: {name:string}[]) {
  const hay = history.slice(-6).map(m=>m.content).join(" ").toLocaleLowerCase("pt-BR");
  return categories.find(c=>hay.includes(c.name.toLocaleLowerCase("pt-BR")))?.name;
}

export async function askLocalFinnos(question: string, month?: string, history: FinnMessage[] = []): Promise<LocalFinnAnswer> {
  const m=month??currentMonth(), dashboard=localDashboard(m), budget=localBudget(m), txs=localListTransactions({month:m});
  const q=question.toLocaleLowerCase("pt-BR"), demo=getMode()==="demo";
  const intro=demo?"Usando os dados da demonstração, ":"";
  const metrics=(xs:{label:string;value:string;tone?:"positive"|"negative"|"neutral"}[]):FinnVisual=>({metrics:xs});

  if ((q.includes("todos")||q.includes("lista")||q.includes("quais")) && (q.includes("gasto")||q.includes("despesa")) && (q.includes("categoria")||q.includes("dessa")||q.includes("dela"))) {
    const remembered=priorCategory(history,dashboard.categories);
    const category=dashboard.categories.find(c=>c.name===remembered)??dashboard.categories[0];
    if(!category) return {text:"Ainda não encontrei despesas categorizadas neste mês."};
    const rows=txs.filter(t=>t.type==="despesa"&&t.category_name===category.name);
    return {
      text:`${intro}claro. Estes são os gastos de **${category.name}** em ${monthLabel(m)}. Eles somam ${money(category.total)}. Separei os lançamentos para você conferir:`,
      visual:{title:category.name,items:rows.map(t=>({label:t.name,value:money(t.installment_value??t.value),detail:new Date(t.date+"T12:00:00").toLocaleDateString("pt-BR")}))}
    };
  }
  if(q.includes("quanto gastei")||q.includes("despesa")){
    return {text:`${intro}você gastou **${money(dashboard.expense)}** em ${monthLabel(m)}. Como entraram ${money(dashboard.income)}, o mês está positivo em ${money(dashboard.month_balance)}.`,visual:metrics([{label:"Receitas",value:money(dashboard.income),tone:"positive"},{label:"Despesas",value:money(dashboard.expense),tone:"negative"},{label:"Resultado",value:money(dashboard.month_balance),tone:dashboard.month_balance>=0?"positive":"negative"}])};
  }
  if(q.includes("categoria")||q.includes("gastei mais")||q.includes("gastando mais")||q.includes("onde")){
    const top=dashboard.categories[0]; if(!top)return{text:"Ainda não há despesas categorizadas neste mês."};
    return {text:`${intro}o maior peso está em **${top.name}**: ${money(top.total)}, ou ${top.percent}% das suas despesas. Quer que eu abra os lançamentos dessa categoria ou compare com outra?`,visual:{title:"Maiores categorias",items:dashboard.categories.slice(0,4).map(c=>({label:c.name,value:money(c.total),detail:`${c.percent}% do total`}))}};
  }
  if(q.includes("50/30/20")||q.includes("regra")){
    return {text:`${intro}a sua divisão 50/30/20 está assim. Eu destacaria primeiro qualquer grupo que já passou de 100% do limite.`,visual:{title:"Regra 50/30/20",items:dashboard.rule.map(r=>({label:r.label,value:`${Math.round(r.percent)}%`,detail:`${money(r.spent)} de ${money(r.limit)}`}))}};
  }
  if(q.includes("quanto ainda")||q.includes("posso gastar")||q.includes("orçamento")){
    return {text:`${intro}você ainda tem **${money(Math.max(0,budget.remaining))}** disponível nas categorias orçadas. Já usou ${money(budget.spent)} de ${money(budget.planned)}.`,visual:metrics([{label:"Planejado",value:money(budget.planned)},{label:"Utilizado",value:money(budget.spent),tone:"negative"},{label:"Disponível",value:money(Math.max(0,budget.remaining)),tone:"positive"}])};
  }
  if(q.includes("econom")||q.includes("cortar")||q.includes("plano de ação")||q.includes("plano de acao")){
    const top=dashboard.categories.slice(0,3);if(!top.length)return{text:"Ainda preciso de mais despesas categorizadas para montar um plano útil."};
    const potential=top.reduce((s,x)=>s+x.total*.1,0);
    return {text:`Eu começaria pelos maiores grupos, sem sugerir cortes cegos. Uma redução de 10% nesses três grupos liberaria cerca de **${money(potential)} por mês**. Quer que eu monte um plano conservador ou mais agressivo?`,visual:{title:"Simulação de economia",items:top.map(x=>({label:x.name,value:money(x.total*.1),detail:"simulação de 10%"}))}};
  }
  if(q.includes("radar")||q.includes("atenção")||q.includes("atencao")){
    const over=dashboard.rule.filter(r=>r.percent>100),top=dashboard.categories[0];
    return {text:over.length?`O ponto que mais merece atenção agora é **${over.map(r=>r.label).join(" e ")}**, acima do limite da regra 50/30/20. Posso investigar o que está puxando esse valor.`:`Não vejo um estouro da regra 50/30/20 agora. O maior peso do mês está em **${top?.name??"suas despesas principais"}**. Posso analisar se há alguma anomalia ali.`};
  }
  if(q.includes("vence")||q.includes("vencimento")||q.includes("próxim")||q.includes("proxim")){
    const pending=txs.filter(t=>t.status==="pendente"||t.status==="agendado").slice(0,6);
    if(!pending.length)return{text:"Não encontrei contas pendentes ou agendadas neste mês."};
    return {text:"Encontrei estes próximos compromissos:",visual:{title:"Próximos vencimentos",items:pending.map(t=>({label:t.name,value:money(t.value),detail:new Date(t.date+"T12:00:00").toLocaleDateString("pt-BR")}))}};
  }
  const top=dashboard.categories[0];
  return {text:`${intro}entendi. Olhando o seu mês, você tem ${money(dashboard.income)} de receitas e ${money(dashboard.expense)} de despesas, com resultado de ${money(dashboard.month_balance)}.${top?` O maior gasto está em **${top.name}**.`:""} Me diga o que você quer aprofundar — posso cruzar categorias, orçamento, vencimentos e Radar.`};
}
