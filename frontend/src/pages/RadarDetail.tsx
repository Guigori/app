import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/layout/BackButton";
import { ArrowLeft, Check, ChevronRight, Repeat, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { fetchCalendar, fetchRadar, sendRadarFeedback, updateRadarSignal, fetchTransaction, fetchTransactions, updateTransaction } from "@/lib/data";
import { currentMonth, formatBRL, formatDate } from "@/lib/format";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { RADAR_COLOR, RADAR_ICON, RADAR_LABEL, isRecurringCandidate, radarTarget, severityLabel } from "@/lib/radarUi";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RadarDetail() {
  const { signalId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });
  const signal = data?.items.find((item) => item.id === signalId);
  const isNew = signal?.state === "new";
  const dialogs = useDialogs();
  const month = currentMonth();
  // What caused it: the category's biggest expenses this month, or the lançamento it points at.
  const categoryId = signal?.related_entity_type === "category" ? signal.related_entity_id : null;
  const txId = signal?.related_entity_type === "transaction" ? signal.related_entity_id : null;
  const causes = useQuery({
    queryKey: ["transactions", "radar-causes", categoryId, month],
    queryFn: () => fetchTransactions({ category_id: categoryId!, month, type: "despesa", status: "pago" }),
    enabled: Boolean(categoryId),
  });
  const related = useQuery({ queryKey: ["transaction", txId], queryFn: () => fetchTransaction(txId!), enabled: Boolean(txId) });
  const weighs = signal?.type === "risk" || signal?.type === "deviation";
  const calendar = useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), enabled: Boolean(signal) && weighs });
  // Opening a signal marks it as seen; the list then stops calling it "novo".
  useEffect(() => {
    if (signalId && isNew) void updateRadarSignal(signalId, "view").catch(() => undefined);
  }, [signalId, isNew]);
  const actionMutation = useMutation({
    mutationFn: (action: "dismiss" | "resolve") => updateRadarSignal(signalId!, action),
    onSuccess: async (_r, action) => {
      toast.success(action === "resolve" ? "Marcado como resolvido." : "Sinal dispensado.");
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
      navigate("/radar");
    },
  });
  const fixedMutation = useMutation({ mutationFn: async () => {
    if(signal?.related_entity_type!=="transaction"||!signal.related_entity_id)return;
    const rows=await fetchTransactions({});
    const tx=rows.find(row=>row.id===signal.related_entity_id);
    if(!tx)return;
    await updateTransaction(tx.id,{name:tx.name,value:tx.value,type:tx.type,status:tx.status,date:tx.date,account_id:tx.account_id,card_id:tx.card_id,to_account_id:tx.to_account_id,category_id:tx.category_id,fixed:true,recurrence:"mensal",installment:tx.installment,total_installments:tx.total_installments,current_installment:tx.current_installment,adjusted_value:tx.adjusted_value,attachment:tx.attachment,notes:tx.notes},"manual",tx.version);
    await updateRadarSignal(signal.id,"resolve");
  }, onSuccess: async()=>{toast.success("Marcado como despesa fixa mensal.");await queryClient.invalidateQueries({queryKey:["radar"]});navigate("/radar")}});
  const feedbackMutation = useMutation({
    mutationFn: (feedback: "useful" | "not_useful" | "dont_show_similar") => sendRadarFeedback(signalId!, feedback),
    onSuccess: () => toast.success("Obrigado! O Radar aprende com isso."),
  });

  const goBack = () => {
    const notificationOrigin = sessionStorage.getItem("finnos:notifications-return-origin");
    navigate(notificationOrigin || "/radar");
  };
  const back = (
    <button
      type="button"
      onClick={goBack}
      className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
      aria-label="Voltar"
      data-testid="radar-detail-back"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  if (isPending) return <div className="mx-auto max-w-2xl space-y-4">{back}<div className="h-64 animate-pulse rounded-3xl bg-muted" /></div>;
  if (!signal) return (
    <div className="mx-auto max-w-xl space-y-4">
      {back}
      <div className="rounded-3xl border border-border bg-card p-8 text-center">
        <h1 className="font-heading text-xl font-bold">Este sinal não está mais ativo</h1>
        <p className="mt-2 text-sm text-muted-foreground">A situação pode ter sido resolvida ou substituída por um sinal mais recente.</p>
        <Link to="/radar" className={cn(buttonVariants({ variant: "outline" }), "mt-5")}>Voltar ao Radar</Link>
      </div>
    </div>
  );

  const Icon = RADAR_ICON[signal.type];
  const color = RADAR_COLOR[signal.type];
  const severity = severityLabel(signal);
  const target = radarTarget(signal);
  const recurring = isRecurringCandidate(signal);
  const askAi = () => window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { context: { source: "radar", signalId: signal.id, type: signal.type, severity: signal.severity, title: signal.title, description: signal.description, explanation: signal.explanation, metric: signal.metric, evidence: signal.evidence }, question: "Analise este Radar e explique o impacto no meu mês. Se houver uma ação possível, proponha sem executar nada." } }));

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <ScreenHeader title="Radar" subtitle={RADAR_LABEL[signal.type]} onBack={goBack} keepSubtitle backLabel="Voltar" />
      <section className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="p-6 sm:p-8" style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${color} 10%, transparent), transparent)` }}>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="text-sm font-semibold" style={{ color }}>{RADAR_LABEL[signal.type]}</span>
            {severity ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>{severity}</span> : null}
          </div>
          <h1 className="mt-4 font-heading text-2xl font-bold tracking-tight">{signal.title}</h1>
          <p data-keep className="mt-2 text-muted-foreground">{signal.description}</p>
          {signal.metric ? <p className="mt-5 font-heading text-4xl font-bold tabular-nums text-foreground">{signal.metric}</p> : null}
        </div>

        <div className="space-y-4 border-t border-border p-6 sm:p-8">
          <div>
            <h2 className="text-sm font-semibold">Por que apareceu</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{signal.explanation}</p>
          </div>
          {signal.evidence.length ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {signal.evidence.map((item) => <div key={item.label} className="rounded-2xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{item.value}</dd></div>)}
            </dl>
          ) : null}
        </div>

        {(() => {
          const rows = categoryId ? [...(causes.data ?? [])].sort((a, b) => b.value - a.value) : related.data ? [related.data] : [];
          if (!rows.length) return null;
          return (
            <div className="border-t border-border p-6 sm:p-8" data-testid="radar-detail-causes">
              <h2 className="text-sm font-semibold">{categoryId ? "O que mais pesou neste mês" : "O lançamento"}</h2>
              <ul className="mt-2 divide-y divide-border/70">
                {rows.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => dialogs.openTransactionDetail(t)} className="flex w-full items-center gap-3 rounded-lg py-2.5 text-left hover:bg-muted/50" data-testid="radar-detail-cause">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.name}</span><span className="block text-xs text-muted-foreground">{formatDate(t.date)} · {t.card_name ?? t.account_name}</span></span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatBRL(t.value)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {rows.length > 5 ? <p className="mt-1 text-xs text-muted-foreground">E mais {rows.length - 5} lançamentos.</p> : null}
            </div>
          );
        })()}

        {weighs && calendar.data ? (
          <div className="border-t border-border p-6 sm:p-8" data-testid="radar-detail-impact">
            <h2 className="text-sm font-semibold">Impacto no mês</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Com o que já está lançado e previsto, o mês deve fechar em <strong className="text-foreground tabular-nums">{formatBRL(calendar.data.projected_balance)}</strong>.
              {(signal.impact ?? 0) > 0 && signal.related_entity_type !== "card" ? <> Sem esse excesso de {formatBRL(signal.impact ?? 0)}, fecharia em <strong className="text-foreground tabular-nums">{formatBRL(calendar.data.projected_balance + (signal.impact ?? 0))}</strong>.</> : null}
            </p>
          </div>
        ) : null}

        <div className="space-y-2 border-t border-border p-6 sm:p-8">
          <h2 className="mb-1 text-sm font-semibold">O que fazer</h2>
          {recurring ? (
            <Link to={`/assinaturas?novo=${encodeURIComponent(signal.id)}`} className={cn(buttonVariants(), "h-11 w-full justify-between rounded-2xl")}>
              <span className="flex items-center gap-2"><Repeat className="h-4 w-4" aria-hidden="true" />Adicionar como assinatura</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Link to={target.to} className={cn(buttonVariants({ variant: recurring ? "outline" : "default" }), "h-11 w-full justify-between rounded-2xl")}>
            {target.label}<ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {recurring ? (
            <button type="button" onClick={() => fixedMutation.mutate()} disabled={fixedMutation.isPending} className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full justify-between rounded-2xl")}>
              {fixedMutation.isPending ? "Confirmando…" : "É uma despesa fixa, não assinatura"}<Check className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" onClick={askAi} className={cn(buttonVariants({ variant: "secondary" }), "h-11 w-full justify-between rounded-2xl")}>
            Analisar com FINNOS IA<Sparkles className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("resolve")} className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full")}><Check className="h-4 w-4" aria-hidden="true" />Resolvido</button>
            <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("dismiss")} className={cn(buttonVariants({ variant: "ghost" }), "h-10 rounded-full")}><X className="h-4 w-4" aria-hidden="true" />Dispensar</button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
        <span className="text-muted-foreground">Esse sinal foi útil?</span>
        {feedbackMutation.isSuccess ? <span className="font-medium">Obrigado pelo retorno.</span> : (
          <>
            <button type="button" onClick={() => feedbackMutation.mutate("useful")} className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 hover:bg-muted" aria-label="Sim, foi útil"><ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />Sim</button>
            <button type="button" onClick={() => feedbackMutation.mutate("not_useful")} className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 hover:bg-muted" aria-label="Não muito útil"><ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />Não</button>
            <button type="button" onClick={() => feedbackMutation.mutate("dont_show_similar")} className="h-8 rounded-full px-3 text-muted-foreground hover:bg-muted hover:text-foreground">Não mostrar parecidos</button>
          </>
        )}
      </div>
    </div>
  );
}
