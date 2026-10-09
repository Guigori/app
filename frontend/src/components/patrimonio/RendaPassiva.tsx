import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
const fmt = (n: number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n);
const demo = [
  {month:"MAI",received:31.20,pending:0},{month:"JUN",received:65.87,pending:0},
  {month:"JUL",received:22.66,pending:0},{month:"AGO",received:47.38,pending:0},
  {month:"SET",received:15.66,pending:0},{month:"OUT",received:0,pending:78.28},
];
export default function RendaPassiva(){
 const [showDemo,setShowDemo]=useState(false);
 const [selected,setSelected]=useState(4);
 const [showPending,setShowPending]=useState(true);
 const data=showDemo?demo:[];
 const point=data[selected];
 const prev=selected>0?data[selected-1]:undefined;
 const amount=point?point.received+point.pending:0;
 const previous=prev?prev.received+prev.pending:0;
 const change=previous>0?(amount/previous-1)*100:null;
 return <section className="overflow-hidden rounded-[28px] bg-[#090D0B] p-5 text-white" data-testid="renda-passiva">
  <p className="text-xs font-semibold tracking-wide text-[#A46DFF]">FINNOS · INVESTIMENTOS</p>
  <h2 className="mt-3 text-xl font-bold">O que a carteira te paga de volta</h2>
  <p className="mt-2 text-sm leading-relaxed text-white/55">Dividendos, juros sobre capital próprio e rendimentos de fundos imobiliários.</p>
  <div className="mt-5 flex items-center justify-between gap-2"><strong>Renda passiva</strong><button onClick={()=>setShowDemo(v=>!v)} className="rounded-full border border-white/25 px-3 py-1.5 text-xs">{showDemo?"Ocultar exemplo":"Ver demonstração"}</button></div>
  {!showDemo?<div className="mt-6 rounded-2xl border border-white/15 p-5 text-center"><p className="font-semibold">Sem proventos registrados</p><p className="mt-2 text-sm text-white/55">O gráfico será preenchido com seus rendimentos reais quando estiverem disponíveis.</p></div>:<>
   <div className="mt-4 flex items-center justify-end gap-3 text-xs"><span className="flex items-center gap-1.5 text-white/65"><span className="h-1 w-4 rounded-full bg-[#A46DFF]"/>Recebido</span><button onClick={()=>setShowPending(v=>!v)} className={`flex items-center gap-1.5 ${showPending?"text-white/65":"text-white/30"}`}><span className="h-1 w-4 rounded-full bg-[#5385FF]"/>Em aberto</button></div>
   <div className="mt-4 h-48 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:12,right:10,left:10,bottom:0}}><defs><linearGradient id="finnosPassive" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#A46DFF" stopOpacity={0.36}/><stop offset="100%" stopColor="#A46DFF" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ffffff12"/><XAxis dataKey="month" tick={{fill:"#a1a1aa",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip formatter={(v)=>fmt(Number(v))} contentStyle={{background:"#181326",border:"1px solid #A46DFF",borderRadius:14,color:"white"}}/><Area dataKey="received" name="Recebido" stroke="#A46DFF" strokeWidth={3} fill="url(#finnosPassive)" type="monotone" dot={{r:4,fill:"#A46DFF"}}/>{showPending&&<Area dataKey="pending" name="Em aberto" stroke="#5385FF" strokeWidth={2} fill="#5385FF16" type="monotone" dot={{r:4,fill:"#5385FF"}}/>}</AreaChart></ResponsiveContainer></div>
   <div className="mt-3 grid grid-cols-3 gap-2">{data.slice(Math.max(0,Math.min(selected-1,data.length-3)),Math.max(3,Math.min(selected+2,data.length))).map(x=>{const index=data.indexOf(x);const active=index===selected;const pending=x.pending>0;return <button key={x.month} onClick={()=>setSelected(index)} className={`rounded-2xl border p-3 text-center ${active?(pending?"border-[#5385FF] bg-[#5385FF]/10":"border-[#A46DFF] bg-[#A46DFF]/15"):"border-transparent bg-white/[0.03]"}`}><p className="text-xs font-bold text-white/70">{x.month}</p><p className={`mt-3 text-sm font-bold ${active?(pending?"text-[#5385FF]":"text-[#A46DFF]"):"text-white"}`}>{fmt(x.received+x.pending)}</p><p className="mt-1 text-[10px] text-white/55">{pending?"Em aberto":"Recebido"}</p></button>})}</div>
   <div className="mt-4 flex items-center justify-between"><button onClick={()=>setSelected(i=>Math.max(0,i-1))} disabled={selected===0} aria-label="Mês anterior" className="rounded-full bg-white/10 p-2 disabled:opacity-30"><ChevronLeft/></button><div className="text-center"><strong>{point?.month} · {fmt(amount)}</strong><p className={`text-xs ${change!==null&&change>=0?"text-green-400":"text-red-400"}`}>{change===null?"Primeiro mês":`${change>=0?"▲":"▼"} ${Math.abs(change).toFixed(1).replace(".",",")}% em relação ao anterior`}</p></div><button onClick={()=>setSelected(i=>Math.min(data.length-1,i+1))} disabled={selected===data.length-1} aria-label="Próximo mês" className="rounded-full bg-white/10 p-2 disabled:opacity-30"><ChevronRight/></button></div>
   <p className="mt-5 text-center text-xs text-white/45">Valores exclusivamente ilustrativos. Não representam seus investimentos.</p>
  </>}
 </section>;
}
