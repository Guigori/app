import { useState } from "react";
import { CalendarDays, Eye, EyeOff, SlidersHorizontal, LayoutGrid, ChartLine, ChartPie, ChartColumn, ChartNoAxesCombined, ChevronLeft, ChevronRight, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinnosView = "Cards" | "Projeção" | "Linhas" | "Pizza" | "Barras";
export type FinnosSeries = "Receitas" | "Despesas" | "Resultado";
export interface FinnosVerticalMenuProps {
  month: string;
  onMonthChange: (month: string) => void;
  hidden: boolean;
  onToggleHidden: () => void;
  view?: FinnosView;
  onViewChange?: (view: FinnosView) => void;
  interval?: string;
  onIntervalChange?: (interval: string) => void;
  series?: FinnosSeries[];
  onSeriesChange?: (series: FinnosSeries[]) => void;
  showPeriod?: boolean;
  showVisualization?: boolean;
  className?: string;
}
const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const YEARS = Array.from({length: 61},(_,i)=>2000+i);
const VIEWS: {name:FinnosView; Icon: typeof LayoutGrid}[] = [
  {name:"Cards",Icon:LayoutGrid},{name:"Projeção",Icon:ChartNoAxesCombined},{name:"Linhas",Icon:ChartLine},{name:"Pizza",Icon:ChartPie},{name:"Barras",Icon:ChartColumn}
];
const RANGES = ["7 dias","1 mês","3 meses","6 meses","1 ano"];
const ALL_SERIES: FinnosSeries[] = ["Receitas","Despesas","Resultado"];
export function FinnosVerticalMenu({month,onMonthChange,hidden,onToggleHidden,view="Cards",onViewChange,interval="1 mês",onIntervalChange,series=ALL_SERIES,onSeriesChange,showPeriod=true,showVisualization=true,className}:FinnosVerticalMenuProps) {
  const [expanded,setExpanded]=useState(false);
  const [section,setSection]=useState("");
  const [movement,setMovement]=useState("Todos");
  const [category,setCategory]=useState("Todas");
  const [search,setSearch]=useState("");
  const [localRange,setLocalRange]=useState(interval);
  const [localSeries,setLocalSeries]=useState<FinnosSeries[]>(series);
  const [localView,setLocalView]=useState<FinnosView>(view);
  const [localMonth,setLocalMonth]=useState(month);
  const effectiveRange=onIntervalChange?interval:localRange;
  const effectiveSeries=onSeriesChange?series:localSeries;
  const effectiveView=onViewChange?view:localView;
  const currentMonth=onMonthChange?month:localMonth;
  const [yearString,monthString]=currentMonth.split("-");
  const year=Number(yearString)||new Date().getFullYear();
  const monthIndex=Math.max(0,Math.min(11,(Number(monthString)||1)-1));
  const filterActive=effectiveRange!=="1 mês"||movement!=="Todos"||category!=="Todas"||search.trim()!==""||ALL_SERIES.some(s=>!effectiveSeries.includes(s));
  const changeYear=(y:number)=>{const next=`${y}-${String(monthIndex+1).padStart(2,"0")}`;setLocalMonth(next);onMonthChange(next)};
  const changeMonth=(m:number)=>{const next=`${year}-${String(m+1).padStart(2,"0")}`;setLocalMonth(next);onMonthChange(next)};
  const changeView=(v:FinnosView)=>{setLocalView(v);onViewChange?.(v)};
  const changeRange=(v:string)=>{setLocalRange(v);onIntervalChange?.(v)};
  const changeSeries=(v:FinnosSeries)=>{const next=effectiveSeries.includes(v)?effectiveSeries.filter(s=>s!==v):[...effectiveSeries,v];setLocalSeries(next);onSeriesChange?.(next)};
  const reset=()=>{changeRange("1 mês");setMovement("Todos");setCategory("Todas");setSearch("");setLocalSeries(ALL_SERIES);onSeriesChange?.(ALL_SERIES)};
  const close=()=>{setExpanded(false);setSection("")};
  const button="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-white transition-colors hover:bg-[#20143c]";
  const iconCircle=(active:boolean)=>cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",active?"border-[#6744ff] bg-[#4B2CFF]":"border-[#242035] bg-[#0c0a17]");
  const openSection=(id:string)=>setSection(p=>p===id?"":id);
  return <div className={cn("relative z-30 flex justify-end",className)} data-testid="finnos-vertical-menu">
    {expanded&&<button type="button" aria-label="Fechar menu" onClick={close} className="fixed inset-0 z-[-1] bg-black/25 backdrop-blur-[3px]" />}
    {!expanded?<div className="flex flex-col gap-2 rounded-full border border-[#884dff] bg-[#080710] p-2 shadow-xl">
      <button type="button" aria-label={hidden?"Mostrar valores":"Ocultar valores"} onClick={onToggleHidden} className={cn("rounded-full p-2 text-white",hidden&&"bg-[#4B2CFF]")}>{hidden?<EyeOff size={20}/>:<Eye size={20}/>}</button>
      <button type="button" aria-label="Abrir filtros e menu vertical" onClick={()=>setExpanded(true)} className={cn("rounded-full p-2 text-white",filterActive&&"bg-[#4B2CFF]")}><SlidersHorizontal size={20}/></button>
    </div>:<div className="w-[min(330px,calc(100vw-32px))] rounded-[22px] border border-[#8a48ff] bg-[#07060f] p-2 text-white shadow-2xl">
      <div className="flex justify-end"><button type="button" aria-label="Recolher menu" onClick={close} className="rounded-lg p-1 text-[#b7afc8]"><Minimize2 size={17}/></button></div>
      {showPeriod&&<><button type="button" onClick={()=>openSection("period")} className={cn(button,section==="period"&&"bg-[#1e103e]")}><span className={iconCircle(section==="period")}><CalendarDays size={18}/></span><span className="flex-1"><span className="block">Período</span><span className="text-[11px] text-[#b0a8c2]">{MONTHS[monthIndex]} de {year}</span></span></button>
      {section==="period"&&<div className="space-y-3 rounded-xl border border-[#201a32] bg-[#0d0c18] p-3">
        <div className="flex items-center justify-between"><button aria-label="Ano anterior" onClick={()=>changeYear(year-1)}><ChevronLeft size={18}/></button><strong>{year}</strong><button aria-label="Próximo ano" onClick={()=>changeYear(year+1)}><ChevronRight size={18}/></button></div>
        <div className="grid grid-cols-4 gap-2">{MONTHS.map((m,i)=><button key={m} type="button" onClick={()=>changeMonth(i)} className={cn("rounded-full px-1 py-2 text-xs",i===monthIndex?"bg-[#4B2CFF]":"bg-[#070611]")}>{m}</button>)}</div>
        <div className="h-px bg-[#302940]"/>
        <div className="flex snap-x gap-1 overflow-x-auto pb-1" aria-label="Arraste horizontalmente para escolher o ano">{YEARS.map(y=><button type="button" key={y} onClick={()=>changeYear(y)} className={cn("min-w-[56px] snap-center rounded-full px-2 py-2 text-xs",y===year?"bg-[#4B2CFF] text-white":"text-[#a8a1b8]")}>{y}</button>)}</div>
      </div>}</>}
      <div className="my-1 h-px bg-[#211b30]"/><button type="button" onClick={onToggleHidden} className={button}><span className={iconCircle(hidden)}>{hidden?<EyeOff size={18}/>:<Eye size={18}/>}</span><span className="flex-1">{hidden?"Mostrar valores":"Ocultar valores"}</span>{hidden&&<span className="text-xs text-[#a46dff]">Ativo</span>}</button>
      {showVisualization&&<><div className="my-1 h-px bg-[#211b30]"/><button type="button" onClick={()=>openSection("visual")} className={cn(button,section==="visual"&&"bg-[#1e103e]")}><span className={iconCircle(section==="visual")}><LayoutGrid size={18}/></span><span className="flex-1">Visualização<span className="block text-[11px] text-[#b0a8c2]">{effectiveView}</span></span></button>
      {section==="visual"&&<div className="flex gap-2 overflow-x-auto rounded-xl bg-[#0d0c18] p-2">{VIEWS.map(({name,Icon})=><button type="button" key={name} onClick={()=>changeView(name)} className={cn("flex min-w-[100px] flex-col items-center gap-2 rounded-xl border px-3 py-3 text-xs",effectiveView===name?"border-[#845aff] bg-[#4B2CFF]":"border-[#29233d] bg-[#0a0814]")}><Icon size={20}/>{name}</button>)}</div>}</>}
      <div className="my-1 h-px bg-[#211b30]"/><button type="button" onClick={()=>openSection("filters")} className={cn(button,section==="filters"&&"bg-[#1e103e]")}><span className={iconCircle(filterActive||section==="filters")}><SlidersHorizontal size={18}/></span><span className="flex-1">Filtros{filterActive&&<span className="block text-[11px] text-[#a46dff]">Ativos</span>}</span></button>
      {section==="filters"&&<div className="space-y-3 rounded-xl bg-[#10101c] p-3 text-xs">
        <p className="text-[#afa7c0]">INTERVALO</p><div className="flex gap-2 overflow-x-auto">{RANGES.map(r=><button type="button" key={r} onClick={()=>changeRange(r)} className={cn("shrink-0 rounded-full border px-3 py-2",effectiveRange===r?"border-[#875fff] bg-[#4B2CFF]":"border-[#302840] bg-[#070611]")}>{r}</button>)}</div>
        <div className="h-px bg-[#302840]"/><p className="text-[#afa7c0]">EXIBIR NO GRÁFICO</p><div className="grid grid-cols-3 gap-1">{ALL_SERIES.map(s=><button type="button" key={s} onClick={()=>changeSeries(s)} className={cn("rounded-full border px-1 py-2 text-[10px]",effectiveSeries.includes(s)?"border-[#875fff] bg-[#4B2CFF]":"border-[#302840] bg-[#070611]")}>{s}</button>)}</div>
        <div className="h-px bg-[#302840]"/><p className="text-[#afa7c0]">TIPO DE MOVIMENTAÇÃO</p><div className="flex gap-1">{["Todos","Entradas","Saídas"].map(t=><button type="button" key={t} onClick={()=>setMovement(t)} className={cn("flex-1 rounded-full border px-1 py-2",movement===t?"border-[#875fff] bg-[#4B2CFF]":"border-[#302840] bg-[#070611]")}>{t}</button>)}</div>
        <label className="block text-[#afa7c0]">CATEGORIA<select aria-label="Categoria" value={category} onChange={e=>setCategory(e.target.value)} className="mt-2 w-full rounded-lg border border-[#302840] bg-[#080711] p-2 text-white">{["Todas","Moradia","Alimentação","Transporte","Compras"].map(c=><option key={c}>{c}</option>)}</select></label>
        <label className="block text-[#afa7c0]">BUSCAR<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar transação" className="mt-2 w-full rounded-lg border border-[#302840] bg-[#080711] p-2 text-white"/></label>
        <div className="flex items-center justify-between gap-2"><span className="text-[#a46dff]">{filterActive?"Filtros ativos":"Filtros padrão"}</span><button type="button" onClick={reset} className="rounded-lg border border-[#302840] px-3 py-2">Limpar</button></div>
      </div>}
    </div>}
  </div>;
}
