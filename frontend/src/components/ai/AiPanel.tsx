import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { getMode, isLocalMode } from "@/lib/mode";
import { askLocalFinnos } from "@/lib/local/ai";
import { clearFinnConversations, newFinnConversation, readFinnConversations, upsertFinnConversation, type FinnConversation } from "@/lib/aiConversations";
import type { AiAnswer, AiKey, AiProvider } from "@/types/finnos";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigationPreferences } from "@/lib/navigationPreferences";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const BASE_SUGGESTIONS = ["Quanto gastei este mês?", "Onde posso economizar?", "Como está minha regra 50/30/20?", "O que merece minha atenção no Radar?"];

export function AiPanel() {
  const [open,setOpen]=useState(false), [historyOpen,setHistoryOpen]=useState(false), [question,setQuestion]=useState(""), [error,setError]=useState<string|null>(null);
  const [conversation,setConversation]=useState<FinnConversation>(()=>newFinnConversation());
  const [history,setHistory]=useState<FinnConversation[]>(()=>readFinnConversations());
  const local=isLocalMode(), appMode=getMode(), navigationPreferences=useNavigationPreferences();
  const [triggerVisible,setTriggerVisible]=useState(true), triggerTimer=useRef<number|null>(null);
  const isMobile=typeof window!=="undefined"&&window.matchMedia("(max-width: 767px)").matches;
  const showTrigger=isMobile?navigationPreferences.aiMobile:navigationPreferences.aiWeb;

  useEffect(()=>{const openFromContext=(event:Event)=>{const detail=(event as CustomEvent<{question?:string}>).detail;setOpen(true);setHistoryOpen(false);if(detail?.question)setQuestion(detail.question)};window.addEventListener("finnos-ai-open",openFromContext);return()=>window.removeEventListener("finnos-ai-open",openFromContext)},[]);
  useEffect(()=>{const onScroll=()=>{setTriggerVisible(false);if(triggerTimer.current)clearTimeout(triggerTimer.current);triggerTimer.current=window.setTimeout(()=>setTriggerVisible(true),220)};window.addEventListener("scroll",onScroll,{passive:true});return()=>window.removeEventListener("scroll",onScroll)},[]);
  const keysQuery=useQuery({queryKey:["ai-keys"],queryFn:()=>apiGet<AiKey[]>("/ai/keys"),enabled:open&&!local,staleTime:30000});
  const activeProvider=(keysQuery.data?.[0]?.provider||"") as AiProvider|"";
  const askMutation=useMutation({mutationFn:({q,history}:{q:string;history:{role:"user"|"assistant";content:string}[]})=>apiPost<AiAnswer>("/ai/ask",{provider:activeProvider,question:q,history})});

  const suggestions=useMemo(()=>{
    const used=conversation.messages.filter(m=>m.role==="user").map(m=>m.content.toLowerCase());
    return BASE_SUGGESTIONS.filter(s=>!used.some(u=>u.includes(s.toLowerCase().slice(0,12)))).slice(0,3);
  },[conversation.messages]);

  const persist=(next:FinnConversation)=>{setConversation(next);upsertFinnConversation(next);setHistory(readFinnConversations())};
  const startNew=()=>{setConversation(newFinnConversation());setQuestion("");setError(null);setHistoryOpen(false)};
  const ask=async(q:string)=>{
    const text=q.trim(); if(!text)return; setQuestion("");setError(null);
    const user={id:crypto.randomUUID(),role:"user" as const,content:text,createdAt:new Date().toISOString()};
    let next={...conversation,title:conversation.messages.length?conversation.title:text.slice(0,52),messages:[...conversation.messages,user]};persist(next);
    try{
      const reply=local?await askLocalFinnos(text):(await askMutation.mutateAsync({q:text,history:conversation.messages.slice(-12).map(({role,content})=>({role,content}))})).answer;
      next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:reply,createdAt:new Date().toISOString()}]};persist(next);
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
          </div>:conversation.messages.map(m=><div key={m.id} className={m.role==="user"?"flex justify-end":"flex justify-start gap-3"}>{m.role==="assistant"?<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Sparkles className="h-4 w-4"/></div>:null}<div className={m.role==="user"?"max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground":"max-w-[88%] rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-line"}>{m.content}</div></div>)}
          {askMutation.isPending?<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Analisando suas finanças…</div>:null}
          {error?<p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>:null}
        </main>
        <footer className="border-t border-border bg-background p-4">
          <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void ask(question)}}><Input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte sobre suas finanças…" maxLength={2000}/><Button type="submit" size="icon" disabled={!question.trim()||askMutation.isPending}><Send className="h-4 w-4"/></Button></form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">A FINNOS IA pode cometer erros. Confira informações financeiras importantes.</p>
        </footer>
      </>}
    </SheetContent>
  </Sheet>;
}
