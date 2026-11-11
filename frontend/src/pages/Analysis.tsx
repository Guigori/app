import { useMemo, useState } from "react";
import { WidgetBoard } from "@/components/insights/WidgetBoard";
import { useRouteState } from "@/lib/routeState";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pinIndex } from "@/lib/chartPin";
import { CalendarDays, ChevronRight, Eye, EyeOff, LayoutGrid, ChartPie, SlidersHorizontal, Sparkles, TrendingUp, WalletCards } from "lucide-react";
import { fetchBudget, fetchCalendar, fetchDashboard, fetchTrends } from "@/lib/data";
import { currentMonth, monthLabel, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { InsightSheet, type InsightDetail } from "@/components/analytics/InsightSheet";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { CalendarClock, ChartColumnBig, Gauge, Layers } from "lucide-react";
import { rhythm, savingsRate } from "@/lib/analysisInsights";
import { Card, CardContent } from "@/components/ui/card";

const money = (v:number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const pct = (v:number) => new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(Math.abs(v))+"%";
const delta = (now:number, prev:number|null) => !prev ? 0 : ((now-prev)/Math.abs(prev))*100;

export default function Analysis() {
  const [month,setMonth] = useRouteState("analise:month",currentMonth);
  const [yearMode,setYearMode] = useRouteState("analise:year",false);
  const [hidden,setHidden] = useState(false);
  const [panel,setPanel] = useState<"calendar"|"filters"|null>(null);
  const [filter,setFilter] = useState<"all"|"income"|"expense">("all");
  const mask=(value:string)=>hidden?"••••••":value;
  const moveMonth=(offset:number)=>{const [y,m]=month.split("-").map(Number);const date=new Date(y,m-1+offset,1);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`)};
  const [mode,setMode] = useRouteState<"cards"|"charts">("analise:mode","cards");
  const dashboard = useQuery({queryKey:["analysis-dashboard",month],queryFn:()=>fetchDashboard(month)});
  const trends = useQuery({queryKey:["analysis-trends",month],queryFn:()=>fetchTrends(6,month)});
  const budget = useQuery({queryKey:["analysis-budget",month],queryFn:()=>fetchBudget(month)});
  const calendar = useQuery({queryKey:["calendar",month],queryFn:()=>fetchCalendar(month)});
  const d=dashboard.data;
  // Real numbers from the month calendar (up to today in the current month).
  const today=todayISO();
  const pastDays=(calendar.data?.days ?? []).filter(day=>day.date.slice(0,7)===month && day.date<=today);
  const peakDay=pastDays.reduce<(typeof pastDays)[number]|null>((best,day)=>day.expense>(best?.expense ?? 0)?day:best,null);
  // The calendar lists only days with entries: count the month's elapsed days from the date.
  const pace=calendar.data?rhythm(month,calendar.data.days,[],today):null;
  const elapsedDays=pace?.daysElapsed ?? 0;
  const daysWithoutSpending=Math.max(elapsedDays-pastDays.filter(day=>day.expense>0).length,0);
  const [detail,setDetail]=useState<InsightDetail|null>(null);
  const label=monthLabel(month);
  const topDays=[...pastDays].filter(day=>day.expense>0).sort((a,b)=>b.expense-a.expense).slice(0,3);
  const details:Record<string,()=>InsightDetail>={
    periodo:()=>({title:"Visão do período",value:mask(money(d?.month_balance ?? 0)),explain:`Resultado de ${label}: tudo o que entrou menos tudo o que saiu no mês. Compras no cartão contam no mês da fatura, e parcelas, uma por mês.`,chart:"income-expense",items:[{label:"Receitas",value:mask(money(d?.income ?? 0)),tone:"income"},{label:"Despesas",value:mask(money(d?.expense ?? 0)),tone:"expense"}],cta:{label:"Abrir Caixa",to:`/transacoes?aba=caixa&month=${month}`}}),
    descobertas:()=>({title:"Descobertas FINNOS",value:top?`${pct(top.percent)} em ${top.name}`:"—",explain:"Onde o seu dinheiro mais foi neste mês, por categoria. A porcentagem é sobre o total de despesas do mês.",items:(d?.categories ?? []).slice(0,5).map(c=>({label:c.name,value:hidden?"••••":`${money(c.total)} · ${pct(c.percent)}`})),cta:{label:"Ver despesas por categoria",to:`/transacoes?aba=caixa&month=${month}&metric=despesas`}}),
    gasto:()=>({title:"Gasto do mês",value:mask(money(d?.expense ?? 0)),explain:d?.prev_expense?`${expenseDelta>0?"Você gastou mais":"Você gastou menos"} que no mês anterior (${mask(money(d.prev_expense))}): ${pct(expenseDelta)} de diferença.`:"Total de despesas do mês. Ainda não há mês anterior para comparar.",chart:"expense",cta:{label:"Ver as despesas do mês",to:`/transacoes?month=${month}&metric=despesas`}}),
    orcamento:()=>({title:"Orçamento",value:budget.data?.planned?`${Math.round((budget.data.spent/budget.data.planned)*100)}% usado`:"Não configurado",explain:budget.data?.planned?`Dos ${mask(money(budget.data.planned))} planejados para o ciclo, ${mask(money(budget.data.spent))} já foram gastos.`:"Defina quanto quer gastar por categoria para acompanhar o ritmo do mês.",cta:{label:budget.data?.planned?"Abrir orçamento":"Configurar orçamento",to:budget.data?.planned?"/orcamento":"/orcamento/configuracoes"}}),
    pico:()=>({title:"Dia de maior gasto",value:peakDay?`${peakDay.date.slice(8,10)}/${peakDay.date.slice(5,7)} · ${mask(money(peakDay.expense))}`:"—",explain:"Os dias do mês, até hoje, em que mais saiu dinheiro. Ajuda a ver se um gasto pontual puxou o mês.",items:topDays.map(day=>({label:`${day.date.slice(8,10)}/${day.date.slice(5,7)}`,value:mask(money(day.expense)),tone:"expense" as const})),cta:{label:"Ver o dia no Fluxo",to:peakDay?`/transacoes?date=${peakDay.date}`:`/transacoes?month=${month}`}}),
    semgastos:()=>({title:"Dias sem gastos",value:`${daysWithoutSpending} de ${elapsedDays}`,explain:"Dias deste mês, até hoje, em que nenhuma despesa foi registrada. Mais dias sem gastos costumam significar um mês mais leve.",cta:{label:"Ver o calendário",to:`/transacoes?month=${month}`}}),
    saldo:()=>({title:"Evolução do saldo",value:mask(money(d?.total_balance ?? 0)),explain:"Soma dos saldos das suas contas hoje. O gráfico mostra quanto sobrou ou faltou em cada mês.",chart:"net",cta:{label:"Abrir Caixa",to:`/transacoes?aba=caixa&month=${month}&metric=caixa`}}),
    pesou:()=>({title:"O que mais pesou",value:top?top.name:"—",explain:top?`${top.name} somou ${mask(money(top.total))}, ${pct(top.percent)} das despesas de ${label}.`:"Ainda não há despesas categorizadas neste mês.",cta:{label:"Ver lançamentos da categoria",to:top?.category_id?`/transacoes?month=${month}&metric=despesas&category_id=${encodeURIComponent(top.category_id)}`:`/transacoes?month=${month}`}}),
  };
  const open=(key:string)=>setDetail(details[key]());
  const expenseDelta=d?delta(d.expense,d.prev_expense):0;
  const incomeDelta=d?delta(d.income,d.prev_income):0;
  const top=d?.categories?.[0];
  const chartData=trends.data?.months ?? [];
  const insight=useMemo(()=>{
    if(!d) return "Preparando suas descobertas financeiras.";
    if(top) return `${top.name} representa ${pct(top.percent)} dos seus gastos neste período.`;
    return d.month_balance>=0 ? "Seu resultado do período está positivo." : "Suas despesas superaram suas receitas neste período.";
  },[d,top]);

  // Teasers for the sub-screens: one real number each.
  const isCurrentMonth=month===currentMonth();
  const projection=isCurrentMonth?pace?.projection ?? null:null;
  const activeTrend=chartData.filter(m=>m.income>0||m.expense>0);
  const avgRate=activeTrend.length?savingsRate(activeTrend.reduce((s,m)=>s+m.income,0),activeTrend.reduce((s,m)=>s+m.expense,0)):null;
  const explore=[
    {to:"/analise/evolucao",title:"Evolução",icon:ChartColumnBig,text:avgRate===null?"Receitas e despesas mês a mês":`Você guarda ${pct(avgRate)} da renda em média`,spark:chartData.map(m=>m.net)},
    {to:`/analise/categorias?month=${month}`,title:"Categorias",icon:Layers,text:top?`${top.name} pesa ${pct(top.percent)} do mês`:"Onde vai o dinheiro e o que mudou",spark:null},
    {to:`/analise/ritmo?month=${month}`,title:"Ritmo do mês",icon:Gauge,text:projection!==null?`No ritmo atual, fecha em ${mask(money(projection))}`:"Gasto por dia e por dia da semana",spark:null},
    {to:"/analise/compromissos",title:"Compromissos",icon:CalendarClock,text:"Parcelas e fixos dos próximos meses",spark:null},
  ];

  return <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Análise</h1><p data-keep className="text-sm text-muted-foreground">{yearMode ? month.slice(0,4) : monthLabel(month)}</p></div>
      <div className="relative z-20 flex flex-row items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm" aria-label="Menu FINNOS">
        <button type="button" onClick={()=>setPanel(panel==="calendar"?null:"calendar")} aria-label="Selecionar mês ou ano" className="grid h-10 w-10 place-items-center rounded-full text-foreground"><CalendarDays className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setHidden(!hidden)} aria-label={hidden?"Mostrar valores":"Ocultar valores"} aria-pressed={hidden} className="grid h-10 w-10 place-items-center rounded-full text-foreground">{hidden?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button>
        <button type="button" onClick={()=>setMode("cards")} aria-label="Modo Cards" aria-pressed={mode==="cards"} className={`grid h-10 w-10 place-items-center rounded-full ${mode==="cards"?"bg-primary text-primary-foreground":"text-foreground"}`}><LayoutGrid className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setMode("charts")} aria-label="Modo Gráficos" aria-pressed={mode==="charts"} className={`grid h-10 w-10 place-items-center rounded-full ${mode==="charts"?"bg-primary text-primary-foreground":"text-foreground"}`}><ChartPie className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setPanel(panel==="filters"?null:"filters")} aria-label="Filtros" className="grid h-10 w-10 place-items-center rounded-full text-foreground"><SlidersHorizontal className="h-5 w-5"/></button>
      </div>
    </header>
    {panel==="calendar" && <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><button onClick={()=>moveMonth(yearMode?-12:-1)} aria-label="Anterior" className="rounded-full p-2">‹</button><span className="font-semibold">{yearMode?month.slice(0,4):monthLabel(month)}</span><button onClick={()=>moveMonth(yearMode?12:1)} aria-label="Próximo" className="rounded-full p-2">›</button></div>
      <div className="flex gap-2"><Button variant={!yearMode?"default":"outline"} onClick={()=>setYearMode(false)}>Mês</Button><Button variant={yearMode?"default":"outline"} onClick={()=>setYearMode(true)}>Ano</Button><Button variant="outline" onClick={()=>setPanel(null)}>Concluir</Button></div>
    </div>}
    {panel==="filters" && <div className="rounded-2xl border bg-card p-4 shadow-sm"><p className="mb-3 font-semibold">Filtrar análises</p><div className="flex flex-wrap gap-2">{(["all","income","expense"] as const).map(v=><Button key={v} variant={filter===v?"default":"outline"} onClick={()=>setFilter(v)}>{v==="all"?"Todos":v==="income"?"Receitas":"Despesas"}</Button>)}</div><Button className="mt-3" variant="outline" onClick={()=>setPanel(null)}>Concluir</Button></div>}
    <button type="button" onClick={()=>open("periodo")} className="block w-full text-left"><Card className="rounded-[24px] transition-colors hover:bg-muted/40"><CardContent className="p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-heading font-semibold">Visão do período</h2><ChevronRight className="h-4 w-4 text-muted-foreground"/></div>
      {mode==="cards" ? <div className="grid grid-cols-3 divide-x">
        {filter!=="expense" && <Metric label="Receitas" value={d?.income ?? 0} change={incomeDelta} hidden={hidden}/>}
        {filter!=="income" && <Metric label="Despesas" value={d?.expense ?? 0} change={expenseDelta} negative hidden={hidden}/>}
        <Metric label="Resultado" value={d?.month_balance ?? 0} change={0} hidden={hidden}/>
      </div> : <div className="h-52">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={.18}/><XAxis dataKey="label" axisLine={false} tickLine={false}/><YAxis hide/><Tooltip active defaultIndex={pinIndex(chartData,(m)=>m.month===month)} formatter={(v)=>money(Number(v))}/><Bar dataKey="income" name="Receitas" fill="var(--income)" radius={[5,5,0,0]}/><Bar dataKey="expense" name="Despesas" fill="var(--expense)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>
      </div>}
    </CardContent></Card></button>

    <WidgetBoard surface="analise" header={<h2 className="px-1 text-sm font-semibold text-muted-foreground">Fixadas</h2>} emptyText="Fixe aqui as análises que você quer ver toda vez." />

    <section aria-label="Explorar análises">
      <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Explorar</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {explore.map(item=>(
          <Link key={item.title} to={item.to} className="flex min-w-0 flex-col rounded-[22px] border border-border bg-card p-4 transition-colors hover:bg-muted/40" data-testid={`analysis-explore-${item.to.split("/")[2].split("?")[0]}`}>
            <span className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><item.icon className="h-4.5 w-4.5"/></span><ChevronRight className="h-4 w-4 text-muted-foreground"/></span>
            <span className="mt-3 font-heading text-sm font-semibold">{item.title}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">{item.text}</span>
            {item.spark&&!hidden?<Sparkline values={item.spark} className="mt-2 h-8 text-primary"/>:null}
          </Link>
        ))}
      </div>
    </section>

    <button type="button" onClick={()=>open("descobertas")} className="block w-full text-left"><Card className="rounded-[24px] border-primary/15 bg-primary/[.035]"><CardContent className="flex items-center gap-3 p-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-5 w-5"/></span>
      <div className="min-w-0 flex-1"><p className="font-heading font-semibold">Descobertas FINNOS</p><p className="text-sm text-muted-foreground">{hidden?"Valores ocultos":insight}</p></div><ChevronRight className="h-4 w-4"/>
    </CardContent></Card></button>

    <div className="grid grid-cols-2 gap-3">
      <AnalysisCard onOpen={()=>open("gasto")} title="Gasto do mês" value={mask(money(d?.expense ?? 0))} note={expenseDelta ? `${expenseDelta>0?"▲":"▼"} ${pct(expenseDelta)} vs. mês anterior` : "Mês atual"}/>
      <AnalysisCard onOpen={()=>open("orcamento")} title="Orçamento" value={hidden?"••••":budget.data?.planned ? `${Math.round((budget.data.spent/budget.data.planned)*100)}%` : "—"} note={budget.data?.planned ? "utilizado" : "não configurado"}/>
      <AnalysisCard onOpen={()=>open("pico")} title="Dia de maior gasto" value={peakDay ? `${peakDay.date.slice(8,10)}/${peakDay.date.slice(5,7)}` : "—"} note={peakDay ? mask(money(peakDay.expense)) : "sem gastos no período"}/>
      <AnalysisCard onOpen={()=>open("semgastos")} title="Dias sem gastos" value={calendar.data ? String(daysWithoutSpending) : "—"} note={`de ${elapsedDays} ${elapsedDays===1?"dia":"dias"}`}/>
    </div>

    <button type="button" onClick={()=>open("saldo")} className="block w-full text-left"><Card className="rounded-[24px] transition-colors hover:bg-muted/40"><CardContent className="p-5">
      <div className="flex items-center justify-between"><div><p className="text-sm font-medium">Evolução do saldo</p><p className="mt-1 text-2xl font-bold">{mask(money(d?.total_balance ?? 0))}</p></div><TrendingUp className="h-5 w-5 text-primary"/></div>
      {mode==="charts" && <div className="mt-3 h-28"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><Area type="monotone" dataKey="net" stroke="var(--primary)" fill="#8C5BFF" fillOpacity={.12} strokeWidth={2}/></AreaChart></ResponsiveContainer></div>}
    </CardContent></Card></button>

    <AnalysisRow to="/assinaturas" title="Assinaturas" value="Ver gastos recorrentes" icon={<WalletCards className="h-5 w-5"/>}/>
    <AnalysisRow onOpen={()=>open("pesou")} title="O que mais pesou neste mês" value={hidden?"••••••":top ? `${top.name} · ${money(top.total)} · ${pct(top.percent)}` : "Sem dados suficientes"} icon={<TrendingUp className="h-5 w-5"/>}/>

    <InsightSheet detail={detail} trend={chartData} hidden={hidden} onClose={()=>setDetail(null)}/>
  </div>
}

function Metric({label,value,change,negative=false,hidden=false}:{label:string,value:number,change:number,negative?:boolean,hidden?:boolean}) {
  return <div className="min-w-0 px-3 first:pl-0 last:pr-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 whitespace-nowrap text-[clamp(0.9rem,4vw,1.25rem)] font-bold tabular-nums">{hidden?"••••••":money(value)}</p><p className={`mt-1 text-xs ${!value?"text-muted-foreground":negative&&change>0?"text-expense":"text-income"}`}>{!value ? "Sem movimento" : change ? `${change>0?"▲":"▼"} ${pct(change)}` : "• período"}</p></div>
}
function AnalysisCard({onOpen,title,value,note}:{onOpen:()=>void,title:string,value:string,note:string}) {
  return <button type="button" onClick={onOpen} className="block min-w-0 text-left"><Card className="h-full min-w-0 rounded-[22px] transition-colors hover:bg-muted/40"><CardContent className="p-4"><div className="flex items-start justify-between gap-1"><p className="text-xs font-medium">{title}</p><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground"/></div><p className="mt-3 truncate text-xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></CardContent></Card></button>
}
function AnalysisRow({to,onOpen,title,value,icon}:{to?:string,onOpen?:()=>void,title:string,value:string,icon:React.ReactNode}) {
 const Wrapper=({children}:{children:React.ReactNode})=>to?<Link to={to} className="block">{children}</Link>:<button type="button" onClick={onOpen} className="block w-full text-left">{children}</button>;
 return <Wrapper><Card className="rounded-[22px] transition-colors hover:bg-muted/40"><CardContent className="flex items-center gap-3 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{title}</p><p className="truncate font-semibold">{value}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground"/></CardContent></Card></Wrapper>
}