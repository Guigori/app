import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, History, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchFinanceHistory, fetchFinanceIntegrity } from "@/lib/data";
import { isLocalMode } from "@/lib/mode";
import type { FinanceHistoryEvent } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const HISTORICAL_REASONS: Record<string, string> = {
  unmatched_paid_snapshots: "Pagamento de fatura sem comprovante bancário equivalente",
  bank_payments_without_snapshot: "Comprovante bancário sem registro de quitação da fatura",
  archived_items_without_purchase: "Compra histórica sem lançamento original",
  closed_cycles_without_snapshot: "Fatura antiga sem registro de pagamento",
  invalid_legacy_amounts: "Valor financeiro histórico inválido",
  uninspectable_cards: "Cartão sem dados suficientes para conferência",
};

const ACTION: Record<string, string> = {
  created: "Cadastrado", updated: "Alterado", deleted: "Excluído",
};
const TYPE: Record<string, string> = {
  categories: "Categoria", transactions: "Lançamento", accounts: "Conta",
  cards: "Cartão", budget_cycles: "Orçamento", institutions: "Instituição",
  subscriptions: "Assinatura", goals: "Meta",
};
const FINANCIAL_KEYS = [
  ["monthly_budget_cents", "Limite mensal"], ["allocated_cents", "Total planejado"],
  ["value_cents", "Valor"], ["limit_cents", "Limite do cartão"],
  ["initial_balance_cents", "Saldo inicial"],
  ["credit_amount_cents", "Crédito na fatura"], ["refund_amount_cents", "Reembolso bancário"],
] as const;
function currency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function amountDelta(item: FinanceHistoryEvent) {
  const before = item.before ?? {};
  const after = item.after ?? {};
  for (const [key, label] of FINANCIAL_KEYS) {
    const a = typeof before[key] === "number" ? Number(before[key]) : null;
    const b = typeof after[key] === "number" ? Number(after[key]) : null;
    if (a != null || b != null) return {
      label, from: a != null ? currency(a) : null, to: b != null ? currency(b) : null,
    };
  }
  return null;
}
function eventTitle(item: FinanceHistoryEvent) {
  const entity = TYPE[item.entity] ?? "Operação";
  const name = String(item.after?.name || item.before?.name || "").trim();
  return `${entity}: ${name || item.entity_id.slice(0, 8)}`;
}

export default function FinanceHistory() {
  const [kind, setKind] = useState("all");
  const integrityQuery = useQuery({
    queryKey: ["finance-integrity"],
    queryFn: fetchFinanceIntegrity,
    enabled: !isLocalMode(),
    staleTime: 60_000,
  });
  const review = integrityQuery.data?.historical_invoices;
  const reviewCount = Object.values(review?.counts ?? {}).reduce((sum, value) => sum + value, 0);
  const query = useInfiniteQuery({
    queryKey: ["finance-history"],
    initialPageParam: "",
    queryFn: ({ pageParam }) => fetchFinanceHistory(50, pageParam || undefined),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  const visible = items.filter(item => kind === "all" || item.entity === kind);
  return <div className="mx-auto max-w-4xl space-y-5 pb-24 animate-fade-up" data-testid="finance-history-page">
    <div>
      <Link to="/orcamento" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold">
            <History className="h-6 w-6 text-primary" aria-hidden="true" /> Histórico financeiro
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro das alterações feitas no FINNOS, inspirado no histórico do FINN.
          </p>
        </div>
        <Button variant="outline" onClick={() => { void query.refetch(); if (!isLocalMode()) void integrityQuery.refetch(); }} disabled={query.isFetching || integrityQuery.isFetching}>
          <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Atualizar
        </Button>
      </div>
    </div>
    {!isLocalMode() && (
      <Card data-testid="historical-invoice-review">
        <CardContent className="space-y-3 p-4">
          <h2 className="font-semibold">Conferência de faturas antigas</h2>
          <p className="text-xs text-muted-foreground">
            Verificação somente leitura: nenhuma fatura será quitada, alterada ou excluída.
          </p>
          {integrityQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Conferindo vínculos de faturas e comprovantes…</p>
          ) : integrityQuery.isError ? (
            <p role="alert" className="text-sm">Não foi possível verificar as faturas antigas.
              <Button variant="outline" size="sm" onClick={() => void integrityQuery.refetch()}>Tentar novamente</Button>
            </p>
          ) : review ? (
            <>
              <p className="text-sm" data-testid="historical-invoice-review-status">
                {reviewCount > 0
                  ? reviewCount + " situação(ões) que precisam de conferência manual."
                  : "Nenhuma divergência detectada. Isso não comprova a migração histórica."}
              </p>
              {reviewCount > 0 && (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Ver pendências de conferência</summary>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {Object.entries(review.counts).filter(([, count]) => count > 0)
                      .map(([reason, count]) => (
                        <li key={reason}>{HISTORICAL_REASONS[reason] ?? reason}: <strong>{count}</strong></li>
                      ))}
                  </ul>
                  <div className="mt-3 space-y-1 border-t pt-3">
                    {review.examples.map((example, index) => (
                      <p key={index} className="text-xs text-muted-foreground">
                        {HISTORICAL_REASONS[example.reason] ?? example.reason} · Cartão: {example.card_id.slice(0, 12)}
                        {example.cycle ? " · Fatura: " + example.cycle : ""}
                        {example.recorded_paid_cents != null ? " · Registrado: " + currency(example.recorded_paid_cents) : ""}
                        {example.matched_bank_payment_cents != null ? " · Comprovado: " + currency(example.matched_bank_payment_cents) : ""}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                Uma compra marcada como paga não comprova a quitação da fatura.
                Compare extratos e faturas antigas antes de reconciliar.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    )}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar tipo de alteração">
      {([["all", "Tudo"], ["categories", "Categorias"], ["transactions", "Lançamentos"],
        ["budget_cycles", "Orçamentos"], ["cards", "Cartões"]] as const).map(([id,label]) =>
        <Button key={id} variant={kind===id?"default":"outline"} size="sm"
          onClick={()=>setKind(id)} aria-pressed={kind===id}>{label}</Button>)}
    </div>
    {query.isPending ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      Carregando o histórico…
    </CardContent></Card> :
    query.isError ? <Card><CardContent className="space-y-3 py-8">
      <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
      <Button onClick={()=>query.refetch()}>Tentar novamente</Button>
    </CardContent></Card> :
    <div className="space-y-2" data-testid="finance-history-items">
      {visible.length===0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma alteração registrada neste filtro. O histórico começa com as próximas operações.
      </CardContent></Card>}
      {visible.map(item => {const amount=amountDelta(item);return <Card key={item.id} className="py-0">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{eventTitle(item)}</p>
            <p className="text-xs text-muted-foreground">
              {ACTION[item.action] ?? "Registrado"} · {TYPE[item.entity] ?? item.entity}
            </p>
            {amount && <p className="text-sm">
              <span className="text-muted-foreground">{amount.label}: </span>
              {amount.from && amount.to && amount.from!==amount.to
                ? <>{amount.from} → <strong>{amount.to}</strong></>
                : <strong>{amount.to ?? amount.from}</strong>}
            </p>}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true"/>
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</time>
          </div>
        </CardContent>
      </Card>})}
      {query.hasNextPage && <Button variant="outline" className="w-full"
        disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>
        {query.isFetchingNextPage ? "Carregando..." : "Carregar alterações anteriores"}
      </Button>}
    </div>}
    <p className="text-xs text-muted-foreground">
      O histórico é somente leitura. Estornos e reembolsos são registrados por operações
      compensatórias, nunca desfazendo pagamentos liquidados automaticamente.
      Operações anteriores à ativação deste recurso não possuem registros retroativos.
    </p>
  </div>;
}
