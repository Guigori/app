import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, FileText, Loader2, Mic, Plus, Send, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { getMode, isLocalMode } from "@/lib/mode";
import { askLocalFinnos } from "@/lib/local/ai";
import { clearFinnConversations, newFinnConversation, readFinnConversations, upsertFinnConversation, type FinnConversation } from "@/lib/aiConversations";
import type { AiAnswer, AiKey, AiProvider, Category, CreditCard } from "@/types/finnos";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigationPreferences } from "@/lib/navigationPreferences";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AiVisual } from "@/components/ai/AiVisual";

const BASE_SUGGESTIONS = ["Quanto gastei este mês?", "Onde posso economizar?", "Como está minha regra 50/30/20?", "O que merece minha atenção no Radar?"];

export function AiPanel() {
  const [open,setOpen]=useState(false), [historyOpen,setHistoryOpen]=useState(false), [question,setQuestion]=useState(""), [error,setError]=useState<string|null>(null), [attachOpen,setAttachOpen]=useState(false), [listening,setListening]=useState(false);
  const [conversation,setConversation]=useState<FinnConversation>(()=>newFinnConversation());
  const [pendingContext,setPendingContext]=useState<Record<string,unknown>|null>(null);
  const [history,setHistory]=useState<FinnConversation[]>(()=>readFinnConversations());
  const local=isLocalMode(), appMode=getMode(), navigationPreferences=useNavigationPreferences();
  const [triggerVisible,setTriggerVisible]=useState(true), triggerTimer=useRef<number|null>(null), fileRef=useRef<HTMLInputElement|null>(null);
  const isMobile=typeof window!=="undefined"&&window.matchMedia("(max-width: 767px)").matches;
  const showTrigger=isMobile?navigationPreferences.aiMobile:navigationPreferences.aiWeb;

  useEffect(()=>{const openFromContext=(event:Event)=>{const detail=(event as CustomEvent<{question?:string;context?:Record<string,unknown>}>).detail;setOpen(true);setHistoryOpen(false);if(detail?.context)setPendingContext(detail.context);if(detail?.question)setQuestion(detail.question)};window.addEventListener("finnos-ai-open",openFromContext);return()=>window.removeEventListener("finnos-ai-open",openFromContext)},[]);
  useEffect(()=>{const onScroll=()=>{setTriggerVisible(false);if(triggerTimer.current)clearTimeout(triggerTimer.current);triggerTimer.current=window.setTimeout(()=>setTriggerVisible(true),220)};window.addEventListener("scroll",onScroll,{passive:true});return()=>window.removeEventListener("scroll",onScroll)},[]);
  const keysQuery=useQuery({queryKey:["ai-keys"],queryFn:()=>apiGet<AiKey[]>("/ai/keys"),enabled:open&&!local,staleTime:30000});
  const activeProvider=(keysQuery.data?.[0]?.provider||"") as AiProvider|"";
  const cardsQuery=useQuery({queryKey:["cards"],queryFn:()=>apiGet<CreditCard[]>("/cards"),enabled:open&&!local,staleTime:30000});
  const categoriesQuery=useQuery({queryKey:["categories"],queryFn:()=>apiGet<Category[]>("/categories"),enabled:open&&!local,staleTime:30000});
  const askMutation=useMutation({mutationFn:({q,history}:{q:string;history:{role:"user"|"assistant";content:string}[]})=>apiPost<AiAnswer>("/ai/ask",{provider:activeProvider,question:q,history})});

  const suggestions=useMemo(()=>{
    const used=conversation.messages.filter(m=>m.role==="user").map(m=>m.content.toLowerCase());
    return BASE_SUGGESTIONS.filter(s=>!used.some(u=>u.includes(s.toLowerCase().slice(0,12)))).slice(0,3);
  },[conversation.messages]);

  const speak=()=>{const w=window as any;const SR=w.SpeechRecognition||w.webkitSpeechRecognition;if(!SR){setError("Ditado por voz não está disponível neste navegador.");return}const rec=new SR();rec.lang="pt-BR";rec.interimResults=false;rec.onstart=()=>setListening(true);rec.onend=()=>setListening(false);rec.onerror=()=>setListening(false);rec.onresult=(e:any)=>setQuestion((v)=>[v,e.results[0][0].transcript].filter(Boolean).join(" "));rec.start()};
  const attachFile=async(file:File)=>{setAttachOpen(false);if(file.size>2_000_000){setError("Use um arquivo de até 2 MB nesta versão.");return}if(file.type.startsWith("text/")||/\\.(csv|txt)$/i.test(file.name)){const body=await file.text();setQuestion(`Analise este arquivo ${file.name} e identifique possíveis lançamentos. Não registre nada sem minha confirmação.\\n\\n${body.slice(0,12000)}`)}else{setQuestion(`Quero analisar o arquivo "${file.name}" para registrar gastos. Mostre uma prévia e peça minha confirmação antes de salvar.`);setError("A leitura automática de imagens/PDFs será concluída pelo processador de documentos do servidor; nenhum lançamento será salvo automaticamente.")}};
  const feedback=(id:string,rating:"up"|"down")=>{if(local){localStorage.setItem(`finnos:ai-feedback:${id}`,rating);return}void apiPost("/ai/feedback",{rating,response_id:id})};
  const persist=(next:FinnConversation)=>{setConversation(next);upsertFinnConversation(next);setHistory(readFinnConversations())};
  const startNew=()=>{setConversation(newFinnConversation());setQuestion("");setError(null);setPendingContext(null);setHistoryOpen(false)};
  const ask=async(q:string)=>{
    const text=q.trim(); if(!text)return; setQuestion("");setError(null);
    const user={id:crypto.randomUUID(),role:"user" as const,content:text,createdAt:new Date().toISOString()};
    let next={...conversation,title:conversation.messages.length?conversation.title:text.slice(0,52),messages:[...conversation.messages,user]};persist(next);
    try{
      const contextualText=pendingContext?`${text}\n\n[Contexto estruturado do FINNOS: ${JSON.stringify(pendingContext)}]`:text;
      const localReply=local?await askLocalFinnos(contextualText,undefined,conversation.messages):null;
      const amountMatch=text.match(/(?:R\\$\\s*)?([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/);
      const amount=amountMatch?Number(amountMatch[1].replace(/\\./g,"").replace(",",".")):0;
      const lower=text.toLowerCase();
      const wantsSimulation=amount>0&&["posso","comprar","gastar","cabe","parcel"].some(k=>lower.includes(k));
      const xPos=lower.indexOf("x");
      const beforeX=xPos>0?lower.slice(Math.max(0,xPos-2),xPos).trim():"";
      const requestedInstallments=/^[0-9]{1,2}$/.test(beforeX)?Math.min(48,Math.max(1,Number(beforeX))):1;
      const normalizedText=lower.normalize("NFD").replace(/[̀-ͯ]/g,"");
      const matchedCard=cardsQuery.data?.find(card=>normalizedText.includes(card.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""))||normalizedText.includes(card.institution.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")));
      const matchedCategory=categoriesQuery.data?.find(cat=>normalizedText.includes(cat.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")));
      const simulation=!local&&wantsSimulation?await apiPost<{projected_30d_before:number;projected_30d_after:number;installment_value:number;level:string;scenarios:{installments:number;installment_value:number;projected_30d_after:number}[];card?:{fits_limit:boolean}|null;budget?:{available_before:number;available_after:number;fits_budget:boolean}|null;writes_data:false}>("/simulate/purchase",{amount,installments:1,compare_installments:true}):null;
      const reply=localReply?.text??(simulation?(()=>{
        const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
        const options=simulation.scenarios.map(s=>`${s.installments}x de ${money(s.installment_value)} → projeção de ${money(s.projected_30d_after)}`).join("\n");
        const budgetLine=simulation.budget?`\nOrçamento da categoria: ${money(simulation.budget.available_before)} disponível antes e ${money(simulation.budget.available_after)} depois.`:"";
        return `Simulei **${money(amount)}** sem criar nenhum lançamento. Seu saldo projetado para os próximos 30 dias parte de **${money(simulation.projected_30d_before)}**. Cenário: **${simulation.level}**.${budgetLine}\n\nComparação:\n${options}\n\nIsso é uma simulação; nenhuma compra ou despesa foi registrada.`;
      })():(await askMutation.mutateAsync({q:contextualText,history:conversation.messages.slice(-12).map(({role,content})=>({role,content}))})).answer);
      setPendingContext(null);
      next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:reply,visual:localReply?.visual,createdAt:new Date().toISOString()}]};persist(next);
    }catch(e){setError(getApiErrorMessage(e,"Não foi possível responder agora."))}
  };

  return <Sheet open={open} onOpenChange={setOpen}>
    {showTrigger?<SheetTrigger className="fixed bottom-[5.75rem] right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary shadow-lg transition-all duration-200 dashboard:md:bottom-[6.25rem] dashboard:md:right-6" style={{opacity:triggerVisible?1:0,pointerEvents:triggerVisible?"auto":"none"}} aria-label="Abrir FINNOS IA"><Sparkles className="h-5 w-5"/></SheetTrigger>:null}
    <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl [&>button]:hidden">
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        {historyOpen?<button onClick={()=>setHistoryOpen(false)} aria-label="Voltar"><ArrowLeft/></button>:<Sparkles className="h-6 w-6 text-primary"/>}
        <div className="min-w-0 flex-1"><h2 className="font-heading text-lg font-bold">{historyOpen?"Conversas anteriores":"FINNOS IA"}</h2><p className="text-xs text-muted-foreground">{historyOpen?"Últimas conversas neste dispositivo":appMode==="demo"?"Assistente financeiro · Demonstração":appMode==="local"?"Assistente financeiro · Local":"Assistente financeiro contextual"}</p></div>
        {!historyOpen?<><Button variant="ghost" size="icon" onClick={startNew} title="Nova conversa"><Plus/></Button><Button variant="ghost" size="icon" onClick={()=>setHistoryOpen(true)} title="Conversas anteriores"><Clock3/></Button></>:null}
        <Button variant="ghost" size="icon" onClick={()=>setOpen(false)} aria-label="Fechar"><X/></Button>
      </header>

      {historyOpen?<div className="flex-1 overflow-y-auto p-5">
        <div className="mb-5 flex items-center justify-between"><p className="text-sm text-muted-foreground">O FINNOS guarda até 3 conversas recentes neste dispositivo.</p>{history.length?<Button variant="ghost" size="sm" onClick={()=>{clearFinnConversations();setHistory([]);startNew()}}><Trash2 className="mr-2 h-4 w-4"/>Limpar</Button>:null}</div>
        <div className="space-y-3">{history.length?history.map(c=><button key={c.id} onClick={()=>{setConversation(c);setHistoryOpen(false)}} className="w-full rounded-2xl border border-border p-4 text-left hover:bg-muted"><strong className="block truncate">{c.title}</strong><span className="text-xs text-muted-foreground">{c.messages.filter(m=>m.role==="user").length} perguntas</span></button>):<p className="py-16 text-center text-sm text-muted-foreground">Nenhuma conversa anterior.</p>}</div>
      </div>:<>
        <main className="flex-1 space-y-4 overflow-y-auto p-5">
          {!conversation.messages.length?<div className="space-y-5">
            <div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Sparkles className="h-5 w-5"/></div><div className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">Olá! Sou a FINNOS IA. Posso analisar seus gastos, orçamento, Radar e ajudar no seu planejamento financeiro. O que você quer entender hoje?</div></div>
            {appMode==="local"?<div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Se quiser conectar ChatGPT, Claude ou Gemini e guardar sua chave com segurança, <Link to="/cadastro" onClick={()=>setOpen(false)} className="font-semibold text-primary">crie sua conta preservando seus dados</Link>.</div>:null}
            <div className="grid gap-2">{suggestions.map(s=><button key={s} onClick={()=>void ask(s)} className="rounded-2xl bg-muted px-4 py-3 text-left text-sm font-medium hover:bg-accent">{s}</button>)}</div>
          </div>:conversation.messages.map(m=><div key={m.id} className={m.role==="user"?"flex justify-end":"flex justify-start gap-3"}>{m.role==="assistant"?<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Sparkles className="h-4 w-4"/></div>:null}<div className={m.role==="user"?"max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground":"max-w-[88%] rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-line"}><span>{m.content.replace(/\*\*/g,"")}</span>{m.role==="assistant"&&m.visual?<AiVisual visual={m.visual}/>:null}{m.role==="assistant"?<div className="mt-2 flex gap-1 text-muted-foreground"><button onClick={()=>feedback(m.id,"up")} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Resposta útil"><ThumbsUp className="h-3.5 w-3.5"/></button><button onClick={()=>feedback(m.id,"down")} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Resposta não útil"><ThumbsDown className="h-3.5 w-3.5"/></button></div>:null}</div></div>)}
          {askMutation.isPending?<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Analisando suas finanças…</div>:null}
          {error?<p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>:null}
        </main>
        <footer className="border-t border-border bg-background p-4">
          <div className="relative"><form className="flex items-center gap-2 rounded-2xl border border-border bg-card p-1.5" onSubmit={e=>{e.preventDefault();void ask(question)}}><Button type="button" variant="ghost" size="icon" onClick={()=>setAttachOpen(v=>!v)} aria-label="Adicionar"><Plus className="h-5 w-5"/></Button><Input className="border-0 bg-transparent shadow-none focus-visible:ring-0" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte ao FINNOS…" maxLength={14000}/><Button type="button" variant="ghost" size="icon" onClick={speak} aria-label="Ditado por voz"><Mic className={listening?"h-5 w-5 text-primary":"h-5 w-5"}/></Button><Button type="submit" size="icon" disabled={!question.trim()||askMutation.isPending}><Send className="h-4 w-4"/></Button></form>{attachOpen?<div className="absolute bottom-14 left-0 z-20 w-64 rounded-2xl border border-border bg-popover p-2 shadow-xl"><button onClick={()=>fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"><FileText className="h-4 w-4"/>Enviar arquivo ou comprovante</button><p className="px-3 py-2 text-[11px] text-muted-foreground">CSV/TXT podem ser analisados agora. Outros arquivos entram no fluxo de confirmação.</p></div>:null}<input ref={fileRef} type="file" className="hidden" accept=".csv,.txt,.pdf,image/*" onChange={e=>{const file=e.target.files?.[0];if(file)void attachFile(file);e.currentTarget.value=""}}/></div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">A FINNOS IA pode cometer erros. Confira informações financeiras importantes.</p>
        </footer>
      </>}
    </SheetContent>
  </Sheet>;
}
