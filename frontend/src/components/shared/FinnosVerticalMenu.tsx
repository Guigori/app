import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const anchorRef=useRef<HTMLDivElement>(null);
  const [anchor,setAnchor]=useState({top:0,right:16});
  useEffect(()=>{
    if(!expanded)return;
    const update=()=>{const rect=anchorRef.current?.getBoundingClientRect();if(rect)setAnchor({top:Math.max(8,rect.top),right:Math.max(8,window.innerWidth-rect.right)});};
    update();
    window.addEventListener("resize",update);
    window.addEventListener("scroll",update,true);
    return ()=>{window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);};
  },[expanded]);
  const [section,setSection]=useState("");
  const [movement,setMovement]=useState("Todos");
  const [category,setCategory]=useState("Todas");
  const [search,setSearch]=useState("");
  const [localRange,setLocalRange]=useState(interval);
  const [localSeries,setLocalSeries]=useState<FinnosSeries[]>(series);
  const [localView,setLocalView]=useState<FinnosView>(view);
  const effectiveRange=onIntervalChange?interval:localRange;
  const effectiveSeries=onSeriesChange?series:localSeries;
  const effectiveView=onViewChange?view:localView;
  const currentMonth=month;
  const [yearString,monthString]=currentMonth.split("-");
  const year=Number(yearString)||new Date().getFullYear();
  const monthIndex=Math.max(0,Math.min(11,(Number(monthString)||1)-1));
  const filterActive=effectiveRange!=="1 mês"||movement!=="Todos"||category!=="Todas"||search.trim()!==""||ALL_SERIES.some(s=>!effectiveSeries.includes(s));
  const changeYear=(y:number)=>{const next=`${y}-${String(monthIndex+1).padStart(2,"0")}`;onMonthChange(next)};
  const changeMonth=(m:number)=>{const next=`${year}-${String(m+1).padStart(2,"0")}`;onMonthChange(next)};
  const changeView=(v:FinnosView)=>{setLocalView(v);onViewChange?.(v)};
  const changeRange=(v:string)=>{setLocalRange(v);onIntervalChange?.(v)};
  const changeSeries=(v:FinnosSeries)=>{const next=effectiveSeries.includes(v)?effectiveSeries.filter(s=>s!==v):[...effectiveSeries,v];setLocalSeries(next);onSeriesChange?.(next)};
  const reset=()=>{changeRange("1 mês");setMovement("Todos");setCategory("Todas");setSearch("");setLocalSeries(ALL_SERIES);onSeriesChange?.(ALL_SERIES)};
  const close=()=>{setExpanded(false);setSection("")};
  const button="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left text-sm text-[#070F52] dark:text-white transition-colors hover:bg-[#eee8ff] dark:hover:bg-[#20143c]";
  const selectedRow="!bg-[#eee8ff] dark:!bg-[#21123f]";
  const pill=(active:boolean)=>cn("rounded-full border px-3 py-2 font-medium transition-colors",active?"border-[#8058ff] !bg-[#4B2CFF] !text-white":"border-[#d9d1f5] !bg-white !text-[#070F52] dark:border-[#302840] dark:!bg-[#080711] dark:!text-white");
  const iconCircle=(active:boolean)=>cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",active?"border-[#6744ff] bg-[#4B2CFF] text-white":"border-[#d9d1f5] bg-[#f4f0ff] text-[#070F52] dark:border-[#242035] dark:bg-[#0c0a17] dark:text-white");
  const openSection=(id:string)=>setSection(p=>p===id?"":id);
  return <div ref={anchorRef} className={cn("relative z-30 flex justify-end",className)} data-testid="finnos-vertical-menu">
    {!expanded?<div className="flex flex-col gap-2 rounded-full border border-[#8c5bff] bg-[#fbfaff] p-2 shadow-lg dark:bg-[#080710]">
      <button type="button" aria-label={hidden?"Mostrar valores":"Ocultar valores"} onClick={onToggleHidden} className={cn("rounded-full p-2 text-[#070F52] dark:text-white",hidden&&"bg-[#4B2CFF] !text-white")}>{hidden?<EyeOff size={20}/>:<Eye size={20}/>}</button>
      <button type="button" aria-label="Abrir filtros e menu vertical" onClick={()=>setExpanded(true)} className={cn("rounded-full p-2 text-[#070F52] dark:text-white",filterActive&&"bg-[#4B2CFF] !text-white")}><SlidersHorizontal size={20}/></button>
    </div>:null}
    {expanded&&createPortal(<>
      <button type="button" aria-label="Fechar menu" onClick={close} className="fixed inset-0 z-[9998] bg-[#070F52]/20 backdrop-blur-[3px]" />
      <div style={{top:anchor.top,right:anchor.right,maxHeight:`calc(100dvh - ${anchor.top}px - 20px)`}} className="fixed z-[9999] w-[min(330px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-[22px] border border-[#a58aff] bg-[#fbfaff] p-2 text-[#070F52] shadow-[0_16px_48px_rgba(7,15,82,0.16)] [scrollbar-width:none] dark:border-[#8c5bff] dark:bg-[#0b0917] dark:text-white">
      <div className="sticky top-0 z-10 flex justify-end bg-[#fbfaff]/95 dark:bg-[#0b0917]/95"><button type="button" aria-label="Recolher menu" onClick={close} className="rounded-lg p-1 text-[#62558d] dark:text-[#b7afc8]"><Minimize2 size={17}/></button></div>
      {showPeriod&&<><button type="button" onClick={()=>openSection("period")} className={cn(button,section==="period"&&selectedRow)}><span className={iconCircle(section==="period")}><CalendarDays size={18}/></span><span className="flex-1"><span className="block">Período</span><span className="text-[11px] text-[#5b5d79] dark:text-[#b0a8c2]">{MONTHS[monthIndex]} de {year}</span></span></button>
      {section==="period"&&<div className="space-y-3 rounded-xl border border-[#e0d8fa] dark:border-[#201a32] bg-[#f8f6ff] dark:bg-[#0d0c18] p-3">
        <div className="flex items-center justify-between"><button aria-label="Ano anterior" onClick={()=>changeYear(year-1)}><ChevronLeft size={18}/></button><strong>{year}</strong><button aria-label="Próximo ano" onClick={()=>changeYear(year+1)}><ChevronRight size={18}/></button></div>
        <div className="grid grid-cols-4 gap-2">{MONTHS.map((m,i)=><button key={m} type="button" onClick={()=>changeMonth(i)} className={cn("rounded-full px-1 py-2 text-xs",i===monthIndex?"bg-[#4B2CFF] text-white":"bg-white text-[#070F52] dark:bg-[#070611] dark:text-white")}>{m}</button>)}</div>
        <div className="h-px bg-[#e0d8fa] dark:bg-[#302940]"/>
        <div className="flex snap-x gap-1 overflow-x-auto pb-1" aria-label="Arraste horizontalmente para escolher o ano">{YEARS.map(y=><button type="button" key={y} onClick={()=>changeYear(y)} className={cn("min-w-[56px] snap-center rounded-full px-2 py-2 text-xs",y===year?"bg-[#4B2CFF] text-white":"text-[#5b5d79] dark:text-[#a8a1b8]")}>{y}</button>)}</div>
      </div>}</>}
      <div className="my-1 h-px bg-[#e0d8fa] dark:bg-[#211b30]"/><button type="button" onClick={onToggleHidden} className={button}><span className={iconCircle(hidden)}>{hidden?<EyeOff size={18}/>:<Eye size={18}/>}</span><span className="flex-1">{hidden?"Mostrar valores":"Ocultar valores"}</span>{hidden&&<span className="text-xs text-[#4B2CFF] dark:text-[#a46dff]">Ativo</span>}</button>
      {showVisualization&&<><div className="my-1 h-px bg-[#e0d8fa] dark:bg-[#211b30]"/><button type="button" onClick={()=>openSection("visual")} className={cn(button,section==="visual"&&selectedRow)}><span className={iconCircle(section==="visual")}><LayoutGrid size={18}/></span><span className="flex-1">Visualização<span className="block text-[11px] text-[#62558d] dark:text-[#b0a8c2]">{effectiveView}</span></span></button>
      {section==="visual"&&<div className="flex snap-x gap-2 overflow-x-auto rounded-xl bg-[#f4f0ff] p-2 [scrollbar-width:none] dark:bg-[#0d0c18]">{VIEWS.map(({name,Icon})=><button type="button" key={name} onClick={()=>changeView(name)} className={cn("flex min-w-[100px] snap-center flex-col items-center gap-2 rounded-xl border px-3 py-3 text-xs",effectiveView===name?"border-[#845aff] bg-[#4B2CFF] text-white":"border-[#d9d1f5] dark:border-[#29233d] bg-white text-[#070F52] dark:bg-[#0a0814] dark:text-white")}><Icon size={20}/>{name}</button>)}</div>}</>}
      <div className="my-1 h-px bg-[#211b30]"/><button type="button" onClick={()=>openSection("filters")} className={cn(button,section==="filters"&&selectedRow)}><span className={iconCircle(filterActive||section==="filters")}><SlidersHorizontal size={18}/></span><span className="flex-1">Filtros{filterActive&&<span className="block text-[11px] text-[#4B2CFF] dark:text-[#a46dff]">Ativos</span>}</span></button>
      {section==="filters"&&<div className="space-y-3 rounded-xl bg-[#f8f6ff] dark:bg-[#10101c] p-3 text-xs">
        <p className="text-[#5b5d79] dark:text-[#afa7c0]">INTERVALO</p><div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">{RANGES.map(r=><button type="button" key={r} onClick={()=>changeRange(r)} className={cn("shrink-0",pill(effectiveRange===r))}>{r}</button>)}</div>
        <div className="h-px bg-[#e0d8fa] dark:bg-[#302840]"/><p className="text-[#62558d] dark:text-[#afa7c0]">EXIBIR NO GRÁFICO</p><div className="grid grid-cols-3 gap-1">{ALL_SERIES.map(s=><button type="button" key={s} onClick={()=>changeSeries(s)} className={cn("min-w-0 px-1 text-[10px]",pill(effectiveSeries.includes(s)))}>{s}</button>)}</div>
        <div className="h-px bg-[#e0d8fa] dark:bg-[#302840]"/><p className="text-[#62558d] dark:text-[#afa7c0]">TIPO DE MOVIMENTAÇÃO</p><div className="flex gap-1">{["Todos","Entradas","Saídas"].map(t=><button type="button" key={t} onClick={()=>setMovement(t)} className={cn("min-w-0 flex-1 px-1",pill(movement===t))}>{t}</button>)}</div>
        <label className="block text-[#62558d] dark:text-[#afa7c0]">CATEGORIA<select aria-label="Categoria" value={category} onChange={e=>setCategory(e.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d1f5] bg-white p-2.5 text-[#070F52] dark:border-[#302840] dark:bg-[#080711] dark:text-white">{["Todas","Moradia","Alimentação","Transporte","Compras"].map(c=><option key={c}>{c}</option>)}</select></label>
        <label className="block text-[#62558d] dark:text-[#afa7c0]">BUSCAR<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar transação" className="mt-2 w-full rounded-xl border border-[#d9d1f5] bg-white p-2.5 text-[#070F52] placeholder:text-[#88819d] dark:border-[#302840] dark:bg-[#080711] dark:text-white"/></label>
        <div className="flex items-center justify-between gap-2"><span className="text-[#4B2CFF] dark:text-[#a46dff]">{filterActive?"Filtros ativos":"Filtros padrão"}</span><button type="button" onClick={reset} className="rounded-xl border border-[#d9d1f5] px-3 py-2 text-[#070F52] dark:border-[#302840] dark:text-white">Limpar</button></div>
      </div>}
      </div>
    </>,document.body)}
  </div>;
}
