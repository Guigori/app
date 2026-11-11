/** "vs mês passado" line and the FINNOS IA summary at the top of an analysis page. */
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { Comparison } from "@/lib/insights/compare";
import { cn } from "@/lib/utils";
import type { AiAnswer, AiKey } from "@/types/finnos";
import { LABEL } from "@/components/insights/InsightShell";

/** "▼ R$ 120,00 (−12%) vs out": green when it is good news, red when it is not. */
export function VsLastMonth({ c, label, format, className }: { c: Comparison | null; label: string; format: (v: number) => string; className?: string }) {
  if (!c) return null;
  if (c.same) return <p className={cn("text-[13px] text-muted-foreground", className)} data-testid="vs-last-month">igual {label}</p>;
  const Icon = c.delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("inline-flex items-center gap-1 text-[13px] font-medium", c.better ? "text-income" : "text-expense", className)} data-testid="vs-last-month">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="tabular-nums">{c.delta > 0 ? "+" : "−"}{format(Math.abs(c.delta))}{c.pct != null && Math.abs(c.pct) >= 0.01 ? ` (${c.delta > 0 ? "+" : "−"}${Math.round(Math.abs(c.pct) * 100)}%)` : ""}</span>
      <span className="font-normal text-muted-foreground">{label}</span>
    </p>
  );
}

/**
 * Two or three sentences about the person's numbers, written when the page opens. FINNOS writes them from the same
 * calculation as the widget; when the account has its own AI key, that AI rewrites them in its words (same numbers).
 */
export function FinnSummary({ title, sentences, context }: { title: string; sentences: string[]; context: Record<string, unknown> }) {
  const local = isLocalMode();
  const keys = useQuery({ queryKey: ["ai-keys"], queryFn: () => apiGet<AiKey[]>("/ai/keys"), enabled: !local, staleTime: 5 * 60_000, retry: false });
  const provider = keys.data?.[0]?.provider;
  const facts = sentences.join(" ");
  const ai = useQuery({
    queryKey: ["ai-summary", title, facts],
    enabled: Boolean(provider) && sentences.length > 0,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: () => apiPost<AiAnswer>("/ai/ask", {
      provider,
      history: [],
      question: `Resuma em no máximo 3 frases curtas, em português, a análise "${title}" para a pessoa, usando só estes fatos e números (não invente outros): ${facts} Contexto: ${JSON.stringify(context)}`,
    }),
  });
  const text = ai.data?.answer?.trim();
  const ask = () => window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { question: `Me explique melhor: ${facts}`, context: { analise: title, ...context } } }));
  if (!sentences.length) return null;
  return (
    <section className="rounded-3xl border border-primary/25 bg-primary/[0.04] p-5" data-testid="finn-summary" aria-live="polite">
      <p className={cn(LABEL, "flex items-center gap-1.5 text-primary")}><Sparkles className="size-3.5" aria-hidden="true" />Resumo do FINNOS IA</p>
      {text ? <p className="mt-2 text-[15px] leading-relaxed">{text}</p> : (
        <ul className="mt-2 space-y-1.5 text-[15px] leading-relaxed">{sentences.map((s) => <li key={s}>{s}</li>)}</ul>
      )}
      <button type="button" onClick={ask} className="mt-3 text-sm font-semibold text-primary" data-testid="finn-summary-ask">Conversar sobre isso</button>
    </section>
  );
}
