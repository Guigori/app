import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bell, ChartPie, Check, ChevronRight, Clock3, FileText, Lightbulb, Mic, PiggyBank, Plus, Sparkles, SquarePen, Wallet } from "lucide-react";
import { ConversationHistory, MessageActions, RichText, Thinking } from "@/components/ai/AiThread";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { getMode, isLocalMode } from "@/lib/mode";
import { askLocalFinnos } from "@/lib/local/ai";
import { askFinnAnalyst, askFinnProposal } from "@/lib/askFinnAnalyst";
import { askFinnConverse } from "@/lib/finnConverse";
import { applyProposal, undoProposal } from "@/lib/finnApply";
import { ProposalCard } from "@/components/ai/ProposalCard";
import { memoryCommand, notesFor, personalSuggestions, readMemory, rememberFeedback, rememberTopic, writeMemory, type FinnMemory } from "@/lib/finnMemory";
import type { FinnAnswer } from "@/lib/finnAnalyst";
import { fetchAccounts, fetchCategories, fetchRadar } from "@/lib/data";
import { clearFinnConversations, deleteFinnConversation, newFinnConversation, readFinnConversations, upsertFinnConversation, type FinnConversation, type FinnMessage } from "@/lib/aiConversations";
import type { AiAnswer, AiKey, AiProvider, CreditCard } from "@/types/finnos";
import { HeaderIconButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/button";
import { useNavigationPreferences } from "@/lib/navigationPreferences";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
// Charts only load when an answer actually has one (keeps recharts out of the first download).
const AiVisual = lazyRetry(() => import("@/components/ai/AiVisual").then((m) => ({ default: m.AiVisual })));

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
  const categoriesQuery=useQuery({queryKey:["categories"],queryFn:fetchCategories,enabled:open,staleTime:30000});
  const accountsQuery=useQuery({queryKey:["accounts"],queryFn:fetchAccounts,enabled:open,staleTime:30000});
  const queryClient=useQueryClient();
  const askMutation=useMutation({mutationFn:({q,history}:{q:string;history:{role:"user"|"assistant";content:string}[]})=>apiPost<AiAnswer>("/ai/ask",{provider:activeProvider,question:q,history})});

  const suggestions=useMemo(()=>{
    const used=conversation.messages.filter(m=>m.role==="user").map(m=>m.content.toLowerCase());
    // The user's own frequent questions come first.
    const mine=personalSuggestions(readMemory());
    return [...new Set([...mine,...BASE_SUGGESTIONS])].filter(s=>!used.some(u=>u.includes(s.toLowerCase().slice(0,12)))).slice(0,4);
  },[conversation.messages]);

  const speak=()=>{const w=window as any;const SR=w.SpeechRecognition||w.webkitSpeechRecognition;if(!SR){setError("Ditado por voz não está disponível neste navegador.");return}const rec=new SR();rec.lang="pt-BR";rec.interimResults=false;rec.onstart=()=>setListening(true);rec.onend=()=>setListening(false);rec.onerror=()=>setListening(false);rec.onresult=(e:any)=>setQuestion((v)=>[v,e.results[0][0].transcript].filter(Boolean).join(" "));rec.start()};
  const attachFile=async(file:File)=>{setAttachOpen(false);if(file.size>2_000_000){setError("Use um arquivo de até 2 MB nesta versão.");return}if(file.type.startsWith("text/")||/\\.(csv|txt)$/i.test(file.name)){const body=await file.text();setQuestion(`Analise este arquivo ${file.name} e identifique possíveis lançamentos. Não registre nada sem minha confirmação.\\n\\n${body.slice(0,12000)}`)}else{setQuestion(`Quero analisar o arquivo "${file.name}" para registrar gastos. Mostre uma prévia e peça minha confirmação antes de salvar.`);setError("A leitura automática de imagens/PDFs será concluída pelo processador de documentos do servidor; nenhum lançamento será salvo automaticamente.")}};
  const feedback=(id:string,rating:"up"|"down")=>{
    const message=conversation.messages.find(m=>m.id===id);
    writeMemory(rememberFeedback(readMemory(),message?.query?.op??"geral",rating));
    // A thumbs-down asks what to change, and the answer teaches the next replies.
    if(rating==="down"&&conversation.messages.at(-1)?.id===id)persist({...conversation,messages:[...conversation.messages,{id:crypto.randomUUID(),role:"assistant",content:"Obrigado pelo retorno. O que eu posso melhorar?",followUps:["Responda mais curto","Quero respostas mais detalhadas","O que você sabe sobre mim?"],createdAt:new Date().toISOString()}]});
    if(local){localStorage.setItem(`finnos:ai-feedback:${id}`,rating);return}void apiPost("/ai/feedback",{rating,response_id:id}).catch(()=>undefined)};
  const persist=(next:FinnConversation)=>{setConversation(next);upsertFinnConversation(next);setHistory(readFinnConversations())};
  const startNew=()=>{setConversation(newFinnConversation());setQuestion("");setError(null);setPendingContext(null);setHistoryOpen(false)};
  const [thinking,setThinking]=useState(false);
  const threadRef=useRef<HTMLElement|null>(null), inputRef=useRef<HTMLTextAreaElement|null>(null);
  // The newest message (and the "thinking" line) stays in view.
  useEffect(()=>{const el=threadRef.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:"smooth"})},[conversation.messages.length,thinking,historyOpen]);
  // The box grows with the question, up to a few lines.
  useEffect(()=>{const el=inputRef.current;if(!el)return;el.style.height="auto";el.style.height=`${Math.min(el.scrollHeight,144)}px`},[question]);
  // Proposal edits and their outcome live on the message, so the conversation keeps them.
  const patchMessage=(id:string,patch:Partial<FinnMessage>)=>setConversation(prev=>{const updated={...prev,messages:prev.messages.map(m=>m.id===id?{...m,...patch}:m)};upsertFinnConversation(updated);setHistory(readFinnConversations());return updated});
  const refresh=()=>queryClient.invalidateQueries();
  // Opening with what matters now, instead of waiting for a question.
  const radarQuery=useQuery({queryKey:["radar"],queryFn:fetchRadar,enabled:open,staleTime:60000});
  const noticed=(radarQuery.data?.items??[]).filter(s=>s.severity==="critical"||s.severity==="high").sort((a,b)=>b.score-a.score)[0];
  const ask=async(q:string)=>{
    const text=q.trim(); if(!text)return; setQuestion("");setError(null);setThinking(true);
    const user={id:crypto.randomUUID(),role:"user" as const,content:text,createdAt:new Date().toISOString()};
    let next={...conversation,title:conversation.messages.length?conversation.title:text.slice(0,52),messages:[...conversation.messages,user]};persist(next);
    try{
      const contextualText=pendingContext?`${text}\n\n[Contexto estruturado do FINNOS: ${JSON.stringify(pendingContext)}]`:text;
      // Lessons first ("lembre que lanche é Restaurantes"), then the analyst, in every mode and at no cost.
      const memory=readMemory();
      const lesson=pendingContext?null:memoryCommand(text,memory,await fetchCategories().catch(()=>[]));
      if(lesson){
        writeMemory(lesson.memory);
        next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:lesson.text,followUps:lesson.followUps,createdAt:new Date().toISOString()}]};persist(next);
        return;
      }
      // A change to make ("café 3,80 e táxi 14", "mova a Padaria para Alimentação") becomes a proposal to review.
      const proposed=pendingContext?null:await askFinnProposal(text,memory.aliases);
      if(proposed){
        next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:proposed.text,steps:proposed.steps,proposal:proposed.proposal,proposalState:proposed.proposal?{status:"pending"}:undefined,followUps:proposed.followUps,createdAt:new Date().toISOString()}]};persist(next);
        return;
      }
      // An analysis being talked about ("Me explique a análise…", the page's "Conversar sobre isso", "e como melhoro?").
      const talk=await askFinnConverse(text,pendingContext,conversation.messages,queryClient,memory.aliases);
      if(talk){
        setPendingContext(null);
        next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:talk.text,visual:talk.visual,steps:talk.steps,followUps:talk.followUps,links:talk.links,topic:talk.topic,createdAt:new Date().toISOString()}]};persist(next);
        return;
      }
      const analyst=pendingContext&&!pendingContext.analise?null:await askFinnAnalyst(text,conversation.messages,memory.aliases);
      if(analyst){
        setPendingContext(null);
        writeMemory(rememberTopic(memory,analyst.query,text));
        const shaped=styled(analyst,memory);
        next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:shaped.text,visual:shaped.visual,steps:analyst.steps,insight:analyst.insight,followUps:analyst.followUps,links:analyst.links,query:analyst.query,createdAt:new Date().toISOString()}]};persist(next);
        return;
      }
      const localReply=local?await askLocalFinnos(contextualText,undefined,conversation.messages):null;
      const amountMatch=text.match(/(?:R\\$\\s*)?([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/);
      const amount=amountMatch?Number(amountMatch[1].replace(/\\./g,"").replace(",",".")):0;
      const lower=text.toLowerCase();
      const wantsSimulation=amount>0&&["posso","comprar","gastar","cabe","parcel"].some(k=>lower.includes(k));
      const installmentToken=lower.split(/\s+/).find(token=>token.length>1&&token.length<=3&&token.endsWith("x")&&Number.isFinite(Number(token.slice(0,-1))));
      const requestedInstallments=installmentToken?Math.min(48,Math.max(1,Number(installmentToken.slice(0,-1)))):1;
      const normalizedText=lower.normalize("NFD").replace(/[̀-ͯ]/g,"");
      const matchedCard=cardsQuery.data?.find(card=>normalizedText.includes(card.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""))||normalizedText.includes(card.institution.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")));
      const matchedCategory=categoriesQuery.data?.find(cat=>normalizedText.includes(cat.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")));
      const simulation=!local&&wantsSimulation?await apiPost<{projected_30d_before:number;projected_30d_after:number;installment_value:number;level:string;scenarios:{installments:number;installment_value:number;projected_30d_after:number}[];card?:{fits_limit:boolean}|null;budget?:{available_before:number;available_after:number;fits_budget:boolean}|null;writes_data:false}>("/simulate/purchase",{amount,installments:requestedInstallments,card_id:matchedCard?.id??null,category_id:matchedCategory?.id??null,compare_installments:true}):null;
      const reply=localReply?.text??(simulation?(()=>{
        const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
        const options=simulation.scenarios.map(s=>`${s.installments}x de ${money(s.installment_value)} → projeção de ${money(s.projected_30d_after)}`).join("\n");
        const budgetLine=simulation.budget?`\nOrçamento da categoria: ${money(simulation.budget.available_before)} disponível antes e ${money(simulation.budget.available_after)} depois.`:"";
        return `Simulei **${money(amount)}** sem criar nenhum lançamento. Seu saldo projetado para os próximos 30 dias parte de **${money(simulation.projected_30d_before)}**. Cenário: **${simulation.level}**.${budgetLine}\n\nComparação:\n${options}\n\nIsso é uma simulação; nenhuma compra ou despesa foi registrada.`;
      })():activeProvider&&!local?await askMutation.mutateAsync({q:contextualText,history:conversation.messages.slice(-12).map(({role,content})=>({role,content}))}).then(r=>r.answer).catch(()=>null):null);
      if(reply===null){
        // No language model here (none configured, or calls not enabled): say what can be asked instead of failing.
        next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:"Não encontrei uma resposta para isso nos seus dados e prefiro não chutar.\n\nO que eu consigo responder com os seus números:\n• Gastos e receitas de um período, categoria, conta, cartão ou estabelecimento\n• Quando foi a última vez que você pagou algo\n• Comparações e evolução por mês\n• Orçamento, saldo, estimativa do mês e contas a vencer\n• Assinaturas, metas, Radar e qualquer análise da biblioteca\n\nTente perguntar de outro jeito, citando o nome como aparece no app.",steps:["Procurei nos seus lançamentos, categorias, contas e análises"],followUps:["Para onde foi meu dinheiro este mês?","Quanto gastei no mês passado comparado com este?","Vou fechar o mês no positivo?"],createdAt:new Date().toISOString()}]};persist(next);
        return;
      }
      setPendingContext(null);
      next={...next,messages:[...next.messages,{id:crypto.randomUUID(),role:"assistant",content:reply,visual:localReply?.visual,createdAt:new Date().toISOString()}]};persist(next);
    }catch(e){setError(getApiErrorMessage(e,"Não foi possível responder agora."))}
    finally{setThinking(false)}
  };

  const lastId=conversation.messages.at(-1)?.id;
  return <Sheet open={open} onOpenChange={setOpen}>
    {/* Phones open the assistant from the header (it no longer floats over content). */}
    {showTrigger&&!isMobile?<SheetTrigger className="fixed bottom-[5.75rem] right-4 z-40 flex lg:hidden h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary shadow-lg transition-all duration-200 dashboard:md:bottom-[6.25rem] dashboard:md:right-6" style={{opacity:triggerVisible?1:0,pointerEvents:triggerVisible?"auto":"none"}} aria-label="Abrir FINNOS IA"><Sparkles className="h-5 w-5"/></SheetTrigger>:null}
    <SheetContent side="right" className="flex w-full flex-col gap-0 bg-background p-0 data-[side=right]:w-full sm:max-w-xl data-[side=right]:sm:max-w-xl [&>button]:hidden">
      <header className="flex items-center gap-3 border-b border-border/70 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* Padrão FINNOS: voltar/fechar à esquerda, título ao lado, ações à direita. */}
        {historyOpen?<HeaderIconButton onClick={()=>setHistoryOpen(false)} label="Voltar"/>:<HeaderIconButton kind="close" onClick={()=>setOpen(false)} label="Fechar"/>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-lg font-bold">{historyOpen?"Conversas":conversation.messages.length?conversation.title:"FINNOS IA"}</h2>
          <p className="truncate text-xs text-muted-foreground">{historyOpen?(n=>`${n} ${n===1?"guardada":"guardadas"} neste dispositivo`)(history.filter(c=>c.messages.length).length):appMode==="demo"?"Com os dados da demonstração":appMode==="local"?"Com os dados deste dispositivo":activeProvider?`Com os seus dados · ${activeProvider}`:"Com os seus dados do FINNOS"}</p>
        </div>
        {!historyOpen?<><HeaderIconButton kind="custom" onClick={()=>setHistoryOpen(true)} label="Conversas anteriores"><Clock3 className="size-5"/></HeaderIconButton><HeaderIconButton kind="custom" onClick={startNew} label="Nova conversa"><SquarePen className="size-5"/></HeaderIconButton></>:null}
      </header>

      {historyOpen?<ConversationHistory items={history} currentId={conversation.id}
        onOpen={c=>{setConversation(c);setHistoryOpen(false)}}
        onDelete={id=>{deleteFinnConversation(id);setHistory(readFinnConversations());if(id===conversation.id)setConversation(newFinnConversation())}}
        onClear={()=>{clearFinnConversations();setHistory([]);startNew()}}
        onNew={startNew}/>:<>
        <main ref={threadRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-5" data-testid="ai-thread">
          {!conversation.messages.length?<div className="mx-auto max-w-lg space-y-6 pt-4">
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-gradient-to-br from-primary to-[var(--finnos-violet)] text-primary-foreground shadow-lg shadow-primary/25"><Sparkles className="size-7"/></span>
              <h3 className="mt-4 font-heading text-2xl font-bold">Como posso ajudar?</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">Pergunte sobre gastos, orçamento, faturas, metas ou qualquer análise. Eu respondo com os seus números e aviso quando não encontrar algo.</p>
            </div>
            {noticed?<button type="button" onClick={()=>void ask("O que o Radar está vendo?")} className="flex w-full items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-left" data-testid="ai-opening-noticed"><span className="mt-0.5 size-2 shrink-0 rounded-full bg-primary"/><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-primary">Hoje eu notei</span><span className="mt-0.5 block text-sm font-medium">{noticed.title}{noticed.metric?` · ${noticed.metric}`:""}</span></span><ChevronRight className="mt-1 size-4 shrink-0 text-primary"/></button>:null}
            <div className="grid grid-cols-2 gap-2">{suggestions.map((s,i)=>{const Icon=[Wallet,PiggyBank,ChartPie,Bell][i%4];return <button key={s} type="button" onClick={()=>void ask(s)} className="flex min-h-[5.5rem] flex-col justify-between rounded-2xl border border-border bg-card p-3.5 text-left text-sm font-medium transition hover:bg-muted"><Icon className="size-4 text-primary" aria-hidden="true"/><span className="mt-2 leading-snug">{s}</span></button>})}</div>
            {appMode==="local"?<p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Para conectar ChatGPT, Claude ou Gemini e guardar sua chave com segurança, <Link to="/cadastro" onClick={()=>setOpen(false)} className="font-semibold text-primary">crie sua conta preservando seus dados</Link>.</p>:null}
            {appMode!=="local"&&appMode!=="demo"&&keysQuery.isSuccess&&!activeProvider?<p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground" data-testid="ai-connect-hint">Para respostas além das análises do FINNOS, <Link to="/configuracoes/integracoes#sua-ia" onClick={()=>setOpen(false)} className="font-semibold text-primary">conecte sua IA</Link> (ChatGPT, Claude ou Gemini).</p>:null}
          </div>:<div className="mx-auto max-w-2xl space-y-6">{conversation.messages.map(m=>m.role==="user"?
            <div key={m.id} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-line rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">{m.content.length>600?`${m.content.slice(0,600)}…`:m.content}</p></div>:
            <article key={m.id} className="min-w-0" data-testid="ai-answer">
              <div className="mb-2 flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-primary to-[var(--finnos-violet)] text-primary-foreground"><Sparkles className="size-3.5"/></span><span className="text-xs font-semibold">FINNOS IA</span><span className="text-[11px] text-muted-foreground">{new Date(m.createdAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span></div>
              {m.steps?.length?<ul className="mb-2.5 flex flex-wrap gap-1.5" data-testid="ai-steps">{m.steps.map(step=><li key={step} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"><Check className="size-3 text-income" aria-hidden="true"/>{step}</li>)}</ul>:null}
              <RichText text={m.content}/>
              {m.proposal&&m.proposalState?<ProposalCard proposal={m.proposal} state={m.proposalState} categories={categoriesQuery.data??[]} accounts={accountsQuery.data??[]}
                onChange={proposal=>patchMessage(m.id,{proposal})}
                onCancel={()=>patchMessage(m.id,{proposalState:{status:"cancelled"}})}
                onApply={async()=>{try{const state=await applyProposal(m.proposal!);patchMessage(m.id,{proposalState:state});await refresh()}catch(e){setError(getApiErrorMessage(e,"Não foi possível salvar tudo agora. Confira no Fluxo o que já entrou antes de tentar de novo."))}}}
                onUndo={async()=>{if(m.proposalState?.status!=="applied")return;try{await undoProposal(m.proposalState);patchMessage(m.id,{proposalState:{status:"undone"}});await refresh()}catch(e){setError(getApiErrorMessage(e,"Não foi possível desfazer agora."))}}}/>:null}
              {m.visual?<Suspense fallback={<div className="mt-3 h-32 animate-pulse rounded-2xl bg-muted"/>}><AiVisual visual={m.visual}/></Suspense>:null}
              {m.insight?<div className="mt-3 flex gap-2.5 rounded-2xl bg-primary/5 p-3 text-[13px] leading-relaxed" data-testid="ai-insight"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true"/><p><span className="font-semibold text-primary">Eu notei também: </span>{m.insight}</p></div>:null}
              {m.links?.length?<div className="mt-3 flex flex-wrap gap-2">{m.links.map(l=><Link key={l.to} to={l.to} onClick={()=>setOpen(false)} className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-primary transition hover:bg-muted">{l.label}<ChevronRight className="size-3.5"/></Link>)}</div>:null}
              <MessageActions text={m.content} onFeedback={rating=>feedback(m.id,rating)}/>
              {m.followUps?.length&&m.id===lastId&&!thinking?<div className="mt-2 flex flex-wrap gap-2" data-testid="ai-follow-ups">{m.followUps.map(f=><button key={f} type="button" onClick={()=>void ask(f)} className="rounded-full border border-primary/25 bg-primary/5 px-3.5 py-2 text-left text-[13px] font-medium text-primary transition hover:bg-primary/10">{f}</button>)}</div>:null}
            </article>)}
            {askMutation.isPending||thinking?<Thinking/>:null}
          </div>}
          {error?<p className="mx-auto mt-4 max-w-2xl rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>:null}
        </main>
        <footer className="border-t border-border/70 bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="relative mx-auto max-w-2xl"><form className="flex items-end gap-1 rounded-3xl border border-border bg-card p-1.5 shadow-sm focus-within:border-primary/50" onSubmit={e=>{e.preventDefault();void ask(question)}}>
            <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={()=>setAttachOpen(v=>!v)} aria-label="Adicionar"><Plus className="h-5 w-5"/></Button>
            <textarea ref={inputRef} rows={1} className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-snug outline-none placeholder:text-muted-foreground" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(question)}}} placeholder="Pergunte ao FINNOS…" maxLength={14000} aria-label="Pergunte ao FINNOS"/>
            {question.trim()?<Button type="submit" size="icon" className="rounded-full" disabled={askMutation.isPending||thinking} aria-label="Enviar"><ArrowUp className="h-4.5 w-4.5"/></Button>:<Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={speak} aria-label="Ditado por voz"><Mic className={listening?"h-5 w-5 text-primary":"h-5 w-5"}/></Button>}
          </form>{attachOpen?<div className="absolute bottom-16 left-0 z-20 w-64 rounded-2xl border border-border bg-popover p-2 shadow-xl"><button onClick={()=>fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"><FileText className="h-4 w-4"/>Enviar arquivo ou comprovante</button><p className="px-3 py-2 text-xs text-muted-foreground">CSV/TXT podem ser analisados agora. Outros arquivos entram no fluxo de confirmação.</p></div>:null}<input ref={fileRef} type="file" className="hidden" accept=".csv,.txt,.pdf,image/*" onChange={e=>{const file=e.target.files?.[0];if(file)void attachFile(file);e.currentTarget.value=""}}/></div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">A FINNOS IA responde com os seus dados e pode errar. Confira valores importantes.</p>
        </footer>
      </>}
    </SheetContent>
  </Sheet>;
}

/** Applies what the user asked about answers: short ones keep the first sentence and the numbers; notes are repeated back. */
function styled(answer: FinnAnswer, memory: FinnMemory): { text: string; visual: FinnAnswer["visual"] } {
  const notes = notesFor(memory, answer.query);
  const said = notes.length ? `\n\nVocê me disse: ${notes.join("; ")}.` : "";
  if (memory.style === "curto") {
    const first = answer.text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? answer.text;
    const visual = answer.visual?.metrics ? { metrics: answer.visual.metrics } : undefined;
    return { text: first + said, visual };
  }
  return { text: answer.text + said, visual: answer.visual };
}
