/** Pieces of the FINNOS IA screen: the answer text, the actions under it, the "thinking" line and the history list. */
import { useMemo, useState } from "react";
import { Check, Copy, MessageSquare, Search, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { conversationGroup, type FinnConversation } from "@/lib/aiConversations";
import { cn } from "@/lib/utils";

/** **bold**, paragraphs and "• " lines as a list: the answers' own small format. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const bold = (line: string) => line.split("**").map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part));
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={cn("space-y-2.5 text-[15px] leading-relaxed", className)}>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        const bullets = lines.filter((l) => /^\s*[•\-–]\s+/.test(l));
        if (bullets.length && bullets.length >= lines.length - 1) {
          const head = lines.length > bullets.length ? lines[0] : null;
          return (
            <div key={b}>
              {head ? <p>{bold(head)}</p> : null}
              <ul className="mt-1 space-y-1.5">
                {bullets.map((l, i) => <li key={i} className="flex gap-2"><span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /><span className="min-w-0">{bold(l.replace(/^\s*[•\-–]\s+/, ""))}</span></li>)}
              </ul>
            </div>
          );
        }
        return <p key={b} className="whitespace-pre-line">{bold(block)}</p>;
      })}
    </div>
  );
}

export function MessageActions({ text, onFeedback }: { text: string; onFeedback: (rating: "up" | "down") => void }) {
  const [copied, setCopied] = useState(false);
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const copy = async () => { try { await navigator.clipboard.writeText(text.replace(/\*\*/g, "")); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const btn = "grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground";
  return (
    <div className="mt-2 flex items-center gap-0.5">
      <button type="button" onClick={() => void copy()} className={btn} aria-label={copied ? "Copiado" : "Copiar resposta"}>{copied ? <Check className="size-3.5 text-income" /> : <Copy className="size-3.5" />}</button>
      <button type="button" onClick={() => { setRated("up"); onFeedback("up"); }} className={cn(btn, rated === "up" && "text-primary")} aria-label="Resposta útil" aria-pressed={rated === "up"}><ThumbsUp className="size-3.5" /></button>
      <button type="button" onClick={() => { setRated("down"); onFeedback("down"); }} className={cn(btn, rated === "down" && "text-primary")} aria-label="Resposta não útil" aria-pressed={rated === "down"}><ThumbsDown className="size-3.5" /></button>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-3" role="status" data-testid="ai-thinking">
      <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="size-2 animate-bounce rounded-full bg-primary/70" style={{ animationDelay: `${i * 140}ms` }} />)}</span>
      <span className="text-sm text-muted-foreground">Procurando nos seus dados…</span>
    </div>
  );
}

const plain = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const time = (iso: string) => {
  const d = new Date(iso), today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
};

export function ConversationHistory({ items, currentId, onOpen, onDelete, onClear, onNew }: {
  items: FinnConversation[]; currentId: string; onOpen: (c: FinnConversation) => void; onDelete: (id: string) => void; onClear: () => void; onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const list = items.filter((c) => c.messages.length && (!q || c.title.toLocaleLowerCase("pt-BR").includes(q) || c.messages.some((m) => m.content.toLocaleLowerCase("pt-BR").includes(q))));
    const groups = new Map<string, FinnConversation[]>();
    for (const c of list) { const g = conversationGroup(c.updatedAt); groups.set(g, [...(groups.get(g) ?? []), c]); }
    return [...groups.entries()];
  }, [items, query]);
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4" data-testid="ai-history">
      <label className="flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nas conversas" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Buscar nas conversas" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X className="size-4 text-muted-foreground" /></button> : null}
      </label>
      <button type="button" onClick={onNew} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground"><MessageSquare className="size-4" />Nova conversa</button>
      {!shown.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{query ? "Nenhuma conversa com esse termo." : "Nenhuma conversa ainda. Suas conversas ficam guardadas neste dispositivo."}</p>
      ) : shown.map(([group, list]) => (
        <section key={group} className="mt-5">
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group}</h3>
          <ul className="mt-2 space-y-2">
            {list.map((c) => {
              const answer = [...c.messages].reverse().find((m) => m.role === "assistant");
              const asked = c.messages.filter((m) => m.role === "user").length;
              return (
                <li key={c.id} className={cn("group flex items-stretch rounded-2xl border bg-card transition hover:bg-muted/50", c.id === currentId ? "border-primary/40" : "border-border")}>
                  <button type="button" onClick={() => onOpen(c)} className="min-w-0 flex-1 px-4 py-3 text-left" data-testid="ai-history-item">
                    <span className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-sm">{c.title}</strong>{c.id === currentId ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Atual</span> : null}<span className="shrink-0 text-[11px] text-muted-foreground">{time(c.updatedAt)}</span></span>
                    {answer ? <span className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{plain(answer.content)}</span> : null}
                    <span className="mt-1.5 block text-[11px] text-muted-foreground">{asked} {asked === 1 ? "pergunta" : "perguntas"}</span>
                  </button>
                  <button type="button" onClick={() => onDelete(c.id)} className="grid w-11 shrink-0 place-items-center text-muted-foreground hover:text-destructive" aria-label={`Apagar a conversa ${c.title}`}><Trash2 className="size-4" /></button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {items.some((c) => c.messages.length) ? (
        <div className="mt-8 text-center">
          {confirmClear ? (
            <span className="inline-flex items-center gap-2 text-sm"><span className="text-muted-foreground">Apagar todas?</span><button type="button" onClick={() => { onClear(); setConfirmClear(false); }} className="font-semibold text-destructive">Apagar</button><button type="button" onClick={() => setConfirmClear(false)} className="font-semibold">Cancelar</button></span>
          ) : <button type="button" onClick={() => setConfirmClear(true)} className="text-sm font-semibold text-muted-foreground hover:text-destructive">Apagar todas as conversas</button>}
          <p className="mt-2 text-xs text-muted-foreground">Até 30 conversas ficam guardadas neste dispositivo.</p>
        </div>
      ) : null}
    </div>
  );
}
