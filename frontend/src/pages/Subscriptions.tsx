import { useQuery } from "@tanstack/react-query";
import { fetchAccounts, fetchCards, fetchRadar, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { isRecurringCandidate } from "@/lib/radarUi";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { SubscriptionsPanel } from "@/components/subscriptions/SubscriptionsPanel";

/** Central de assinaturas: what is registered here plus what Fluxo already shows being charged. */
export default function Subscriptions() {
  const query = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const txQuery = useQuery({ queryKey: ["transactions", "assinaturas"], queryFn: () => fetchTransactions({}), staleTime: 60_000 });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const radar = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-up">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Assinaturas</h1>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="subscriptions-subtitle">Tudo o que você paga todo mês, quando cobra e em qual cartão ou conta.</p>
      </div>
      {query.isPending || txQuery.isPending ? (
        <FinnosPageLoading title="Carregando assinaturas" description="Juntando o que está cadastrado e o que aparece no Fluxo." />
      ) : query.isError || !query.data ? (
        <div className="rounded-2xl border border-destructive/30 bg-card p-5">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar suas assinaturas.</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-full border border-border px-4 py-2 text-sm">Tentar novamente</button>
        </div>
      ) : (
        <SubscriptionsPanel
          data={query.data}
          transactions={txQuery.data ?? []}
          accounts={accounts.data ?? []}
          cards={cards.data ?? []}
          candidates={(radar.data?.items ?? []).filter(isRecurringCandidate)}
        />
      )}
    </div>
  );
}
