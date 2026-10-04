import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchRadar, sendRadarFeedback, updateRadarSignal } from "@/lib/data";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RadarSignal } from "@/types/finnos";

const LABEL = { risk: "Risco", deviation: "Desvio", information: "Informação", opportunity: "Oportunidade" } as const;
const COLOR = { risk: "#FB4A6B", deviation: "#FF9F2F", information: "#8C5BFF", opportunity: "#34D399" } as const;

function target(signal: RadarSignal) {
  if (signal.related_entity_type === "card" && signal.related_entity_id) return `/cartoes/${signal.related_entity_id}`;
  if (signal.related_entity_type === "category" && signal.related_entity_id) return `/fluxo?metric=despesas&category_id=${encodeURIComponent(signal.related_entity_id)}`;
  return "/fluxo";
}

export default function RadarDetail() {
  const { signalId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });
  const signal = data?.items.find((item) => item.id === signalId);
  const actionMutation = useMutation({ mutationFn: (action: "dismiss" | "resolve") => updateRadarSignal(signalId!, action), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["radar"] }); navigate("/radar"); } });
  const feedbackMutation = useMutation({ mutationFn: (feedback: "useful" | "not_useful" | "dont_show_similar") => sendRadarFeedback(signalId!, feedback) });
  if (isPending) return <p className="py-12 text-center text-sm text-muted-foreground">Analisando sinal…</p>;
  if (!signal) return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <h1 className="font-heading text-xl font-bold">Este sinal não está mais ativo</h1>
      <p className="mt-2 text-sm text-muted-foreground">A situação pode ter sido resolvida ou substituída por um sinal mais recente.</p>
      <Link to="/radar" className={cn(buttonVariants({ variant: "outline" }), "mt-5")}>Voltar ao Radar</Link>
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-up">
      <button type="button" onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card hover:bg-accent" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></button>
      <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOR[signal.type] }}>{LABEL[signal.type]}{signal.severity === "critical" ? " crítico" : ""}</p>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight">{signal.title}</h1>
        <p className="mt-3 text-muted-foreground">{signal.description}</p>
        {signal.metric ? <p className="mt-6 font-heading text-4xl font-bold" style={{ color: COLOR[signal.type] }}>{signal.metric}</p> : null}
        <div className="mt-7 border-t border-border pt-5">
          <p className="text-sm font-semibold">Por que apareceu no Radar?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{signal.explanation}</p>
          {signal.evidence.length ? <dl className="mt-4 grid gap-2 sm:grid-cols-2">{signal.evidence.map((item) => <div key={item.label} className="rounded-2xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1 text-sm font-semibold">{item.value}</dd></div>)}</dl> : null}
        </div>
        <div className="mt-6 flex flex-wrap gap-2"><button onClick={() => window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { question: "Analise este alerta do Radar: " + signal.title + ". " + signal.description + " " + signal.explanation } }))} className={buttonVariants({ variant: "secondary" })}>Analisar com FINNOS IA <Sparkles className="h-4 w-4" /></button><Link to={target(signal)} className={cn(buttonVariants(), "w-full sm:w-auto")}>Ver dados relacionados <ExternalLink className="h-4 w-4" /></Link><button onClick={() => actionMutation.mutate("resolve")} className={buttonVariants({ variant: "outline" })}>Marcar como resolvido</button><button onClick={() => actionMutation.mutate("dismiss")} className={buttonVariants({ variant: "ghost" })}>Dispensar</button></div>
        <div className="mt-6 border-t border-border pt-5"><p className="text-sm font-semibold">Esse Radar foi útil?</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => feedbackMutation.mutate("useful")} className={buttonVariants({ variant: "outline", size: "sm" })}>Sim</button><button onClick={() => feedbackMutation.mutate("not_useful")} className={buttonVariants({ variant: "outline", size: "sm" })}>Não muito</button><button onClick={() => feedbackMutation.mutate("dont_show_similar")} className={buttonVariants({ variant: "ghost", size: "sm" })}>Não mostrar sinais assim</button></div></div>
      </section>
    </div>
  );
}
