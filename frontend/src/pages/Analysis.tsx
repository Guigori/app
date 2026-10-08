import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, ChevronRight, Eye, EyeOff, LayoutGrid, ChartPie, SlidersHorizontal, Sparkles, TrendingUp, WalletCards } from "lucide-react";
import { fetchBudget, fetchDashboard, fetchTrends } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const money = (v:number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const pct = (v:number) => new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(Math.abs(v))+"%";
const delta = (now:number, prev:number|null) => !prev ? 0 : ((now-prev)/Math.abs(prev))*100;

export default function Analysis() {
  const [month,setMonth] = useState(currentMonth());
  const [yearMode,setYearMode] = useState(false);
  const [hidden,setHidden] = useState(false);
  const [panel,setPanel] = useState<"calendar"|"filters"|null>(null);
  const [filter,setFilter] = useState<"all"|"income"|"expense">("all");
  const mask=(value:string)=>hidden?"••••••":value;
  const moveMonth=(offset:number)=>{const [y,m]=month.split("-").map(Number);const date=new Date(y,m-1+offset,1);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`)};
  const [mode,setMode] = useState<"cards"|"charts">("cards");
  const dashboard = useQuery({queryKey:["analysis-dashboard",month],queryFn:()=>fetchDashboard(month)});
  const trends = useQuery({queryKey:["analysis-trends",month],queryFn:()=>fetchTrends(6,month)});
  const budget = useQuery({queryKey:["analysis-budget",month],queryFn:()=>fetchBudget(month)});
  const d=dashboard.data;
  const expenseDelta=d?delta(d.expense,d.prev_expense):0;
  const incomeDelta=d?delta(d.income,d.prev_income):0;
  const top=d?.categories?.[0];
  const chartData=trends.data?.months ?? [];
  const insight=useMemo(()=>{
    if(!d) return "Preparando suas descobertas financeiras.";
    if(top) return `${top.name} representa ${pct(top.percent)} dos seus gastos neste período.`;
    return d.month_balance>=0 ? "Seu resultado do período está positivo." : "Suas despesas superaram suas receitas neste período.";
  },[d,top]);

  return <div className="mx-auto w-full max-w-5xl space-y-4 pb-8 animate-fade-up">
    <header className="flex items-start justify-between gap-3">
      <div><h1 className="font-heading text-3xl font-bold tracking-tight">Análise</h1><p className="text-sm text-muted-foreground">{yearMode ? month.slice(0,4) : monthLabel(month)}</p></div>
      <div className="relative z-20 flex flex-col items-center gap-2 rounded-full border border-[#E5E0FF] bg-white p-1.5 shadow-[0_5px_18px_rgba(7,15,82,.09)] dark:bg-[#03081F]" aria-label="Menu vertical FINNOS">
        <button type="button" onClick={()=>setPanel(panel==="calendar"?null:"calendar")} aria-label="Selecionar mês ou ano" className="grid h-11 w-11 place-items-center rounded-full text-[#070F52] dark:text-white"><CalendarDays className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setHidden(!hidden)} aria-label={hidden?"Mostrar valores":"Ocultar valores"} aria-pressed={hidden} className="grid h-11 w-11 place-items-center rounded-full text-[#070F52] dark:text-white">{hidden?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button>
        <button type="button" onClick={()=>setMode("cards")} aria-label="Modo Cards" aria-pressed={mode==="cards"} className={`grid h-11 w-11 place-items-center rounded-full ${mode==="cards"?"bg-[#4B2CFF] text-white":"text-[#070F52] dark:text-white"}`}><LayoutGrid className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setMode("charts")} aria-label="Modo Gráficos" aria-pressed={mode==="charts"} className={`grid h-11 w-11 place-items-center rounded-full ${mode==="charts"?"bg-[#4B2CFF] text-white":"text-[#070F52] dark:text-white"}`}><ChartPie className="h-5 w-5"/></button>
        <button type="button" onClick={()=>setPanel(panel==="filters"?null:"filters")} aria-label="Filtros" className="grid h-11 w-11 place-items-center rounded-full text-[#070F52] dark:text-white"><SlidersHorizontal className="h-5 w-5"/></button>
      </div>
    </header>
    {panel==="calendar" && <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><button onClick={()=>moveMonth(yearMode?-12:-1)} aria-label="Anterior" className="rounded-full p-2">‹</button><span className="font-semibold">{yearMode?month.slice(0,4):monthLabel(month)}</span><button onClick={()=>moveMonth(yearMode?12:1)} aria-label="Próximo" className="rounded-full p-2">›</button></div>
      <div className="flex gap-2"><Button variant={!yearMode?"default":"outline"} onClick={()=>setYearMode(false)}>Mês</Button><Button variant={yearMode?"default":"outline"} onClick={()=>setYearMode(true)}>Ano</Button><Button variant="outline" onClick={()=>setPanel(null)}>Concluir</Button></div>
    </div>}
    {panel==="filters" && <div className="rounded-2xl border bg-card p-4 shadow-sm"><p className="mb-3 font-semibold">Filtrar análises</p><div className="flex flex-wrap gap-2">{(["all","income","expense"] as const).map(v=><Button key={v} variant={filter===v?"default":"outline"} onClick={()=>setFilter(v)}>{v==="all"?"Todos":v==="income"?"Receitas":"Despesas"}</Button>)}</div><Button className="mt-3" variant="outline" onClick={()=>setPanel(null)}>Concluir</Button></div>}
    <Card className="rounded-[24px]"><CardContent className="p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-heading font-semibold">Visão do período</h2><ChevronRight className="h-4 w-4 text-muted-foreground"/></div>
      {mode==="cards" ? <div className="grid grid-cols-3 divide-x">
        {filter!=="expense" && <Metric label="Receitas" value={d?.income ?? 0} change={incomeDelta} hidden={hidden}/>}
        {filter!=="income" && <Metric label="Despesas" value={d?.expense ?? 0} change={expenseDelta} negative hidden={hidden}/>}
        <Metric label="Resultado" value={d?.month_balance ?? 0} change={0} hidden={hidden}/>
      </div> : <div className="h-52">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={.18}/><XAxis dataKey="label" axisLine={false} tickLine={false}/><YAxis hide/><Tooltip formatter={(v)=>money(Number(v))}/><Bar dataKey="income" name="Receitas" fill="#4B2CFF" radius={[5,5,0,0]}/><Bar dataKey="expense" name="Despesas" fill="#A46DFF" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>
      </div>}
    </CardContent></Card>

    <Card className="rounded-[24px] border-primary/15 bg-primary/[.035]"><CardContent className="flex items-center gap-3 p-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-5 w-5"/></span>
      <div className="min-w-0 flex-1"><p className="font-heading font-semibold">Descobertas FINNOS</p><p className="text-sm text-muted-foreground">{hidden?"Valores ocultos":insight}</p></div><ChevronRight className="h-4 w-4"/>
    </CardContent></Card>

    <div className="grid grid-cols-2 gap-3">
      <AnalysisCard title="Gasto do mês" value={mask(money(d?.expense ?? 0))} note={expenseDelta ? `${expenseDelta>0?"▲":"▼"} ${pct(expenseDelta)}` : "Mês atual"} chart={mode==="charts"}/>
      <AnalysisCard title="Orçamento" value={hidden?"••••":budget.data ? `${Math.round((budget.data.spent/Math.max(budget.data.planned,1))*100)}%` : "—"} note="utilizado" chart={mode==="charts"}/>
      <AnalysisCard title="Dia de maior gasto" value="Ver detalhes" note="toque para analisar" chart={mode==="charts"}/>
      <AnalysisCard title="Dias sem gastos" value="—" note="no período" chart={mode==="charts"}/>
    </div>

    <Card className="rounded-[24px]"><CardContent className="p-5">
      <div className="flex items-center justify-between"><div><p className="text-sm font-medium">Evolução do saldo</p><p className="mt-1 text-2xl font-bold">{mask(money(d?.total_balance ?? 0))}</p></div><TrendingUp className="h-5 w-5 text-primary"/></div>
      {mode==="charts" && <div className="mt-3 h-28"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><Area type="monotone" dataKey="net" stroke="#4B2CFF" fill="#8C5BFF" fillOpacity={.12} strokeWidth={2}/></AreaChart></ResponsiveContainer></div>}
    </CardContent></Card>

    <AnalysisRow title="Assinaturas" value="Ver gastos recorrentes" icon={<WalletCards className="h-5 w-5"/>}/>
    <AnalysisRow title="O que mais pesou neste mês" value={hidden?"••••••":top ? `${top.name} · ${money(top.total)} · ${pct(top.percent)}` : "Sem dados suficientes"} icon={<TrendingUp className="h-5 w-5"/>}/>

    <Button variant="outline" className="h-12 w-full rounded-2xl border-primary/20 font-semibold"><SlidersHorizontal className="mr-2 h-4 w-4"/>Modificar painel</Button>
  </div>
}

function Metric({label,value,change,negative=false,hidden=false}:{label:string,value:number,change:number,negative?:boolean,hidden?:boolean}) {
  return <div className="min-w-0 px-3 first:pl-0 last:pr-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-base font-bold sm:text-xl">{hidden?"••••••":money(value)}</p><p className={`mt-1 text-xs ${negative&&change>0?"text-rose-500":"text-emerald-600"}`}>{change ? `${change>0?"▲":"▼"} ${pct(change)}` : "• período"}</p></div>
}
function AnalysisCard({title,value,note,chart}:{title:string,value:string,note:string,chart:boolean}) {
  const bars=[35,52,44,68,61,79,58,86,72];
  return <Card className="min-w-0 rounded-[22px]"><CardContent className="p-4"><div className="flex items-start justify-between gap-1"><p className="text-xs font-medium">{title}</p><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground"/></div><p className="mt-3 truncate text-xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p>{chart&&<div className="mt-3 flex h-9 items-end gap-1">{bars.map((h,i)=><span key={i} className="flex-1 rounded-sm bg-primary/70" style={{height:`${h}%`}}/>)}</div>}</CardContent></Card>
}
function AnalysisRow({title,value,icon}:{title:string,value:string,icon:React.ReactNode}) {
 return <Card className="rounded-[22px]"><CardContent className="flex items-center gap-3 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{title}</p><p className="truncate font-semibold">{value}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground"/></CardContent></Card>
}