import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, RefreshCw, ShieldCheck } from "lucide-react";
import { fetchFiintMaturity } from "@/lib/data";
import { isLocalMode } from "@/lib/mode";

const money = (amount: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(amount);

export function FiintSection({ hidden }: { hidden: boolean }) {
  const local = isLocalMode();
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["fiint", "maturity-v1"],
    queryFn: fetchFiintMaturity,
    enabled: !local,
    staleTime: 60_000,
  });
  if (local) return (
    <section className="rounded-[24px] border bg-card p-5" aria-label="FIINT">
      <h2 className="font-heading text-lg font-bold">FIINT · Acompanhamento</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Entre com sua conta sincronizada para analisar até 12 meses de lançamentos com validação de versão.
      </p>
    </section>
  );
  if (isPending) return (
    <section className="rounded-[24px] border bg-card p-5" role="status">
      <h2 className="font-heading text-lg font-bold">FIINT · Acompanhamento</h2>
      <p className="mt-2 text-sm text-muted-foreground">Conferindo as competências registradas...</p>
    </section>
  );
  if (isError || !data) return (
    <section className="rounded-[24px] border border-destructive/30 bg-card p-5" role="alert">
      <h2 className="font-heading text-lg font-bold">FIINT indisponível</h2>
      <p className="mt-2 text-sm">O histórico não foi certificado nesta consulta. Nenhum índice foi estimado.</p>
      <button type="button" onClick={() => void refetch()} className="mt-3 text-sm font-semibold underline">
        Tentar novamente
      </button>
    </section>
  );
  const completed = data.criteria.filter(item => item.completed).length;
  const max = Math.max(1, ...data.monthly_history.flatMap(m => [Math.abs(m.income), Math.abs(m.expense)]));
  return (
    <section className="space-y-5 rounded-[24px] border bg-card p-5" aria-label="FIINT" data-testid="fiint-maturity">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-primary">FIINT · D1 até 12 meses</p>
          <h2 className="mt-1 font-heading text-xl font-bold">Maturidade do seu acompanhamento</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">Este índice mede o preenchimento e a continuidade dos registros, não sua saúde financeira.</p>
        </div>
        <button type="button" title="Atualizar FIINT" aria-label="Atualizar FIINT"
          className="rounded-xl border p-2 hover:bg-muted" disabled={isFetching}
          onClick={() => void refetch()}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
        <div className="rounded-2xl bg-[#070F52] p-5 text-white">
          <p className="text-sm text-white/75">{data.score_label}</p>
          <p className="mt-3 text-4xl font-bold">{data.score}<span className="text-base text-white/60">/100</span></p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-[#A46DFF]" style={{ width: `${Math.min(100, Math.max(0, data.score))}%` }} />
          </div>
          <p className="mt-3 text-xs text-white/70">{completed} de {data.criteria.length} critérios atendidos</p>
        </div>
        <div className="rounded-2xl border p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="font-semibold">{data.stage === "D1" ? "Primeiros registros" : `Etapa M${data.maturity_month} de 12`}</p>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {data.months_observed} {data.months_observed === 1 ? "mês com movimentação confirmada" : "meses com movimentações confirmadas"} no período analisado.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Histórico conciliado com a revisão financeira {data.finance_revision}.</p>
        </div>
      </div>
      <div>
        <h3 className="font-semibold">Critérios verificáveis</h3>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {data.criteria.map(item => (
            <li key={item.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              {item.completed
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="flex-1">{item.label}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">+{item.points}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-semibold">Últimas 12 competências</h3>
        <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-12" role="list" aria-label="Movimentações por mês">
          {data.monthly_history.map(row => (
            <div role="listitem" key={row.month}
              title={`${row.month}: ${row.entries} lançamentos confirmados`}
              className="flex min-w-0 flex-col items-center gap-1">
              <div className="flex h-14 w-full items-end gap-px rounded-t bg-muted/40 px-1">
                <div className="w-1/2 rounded-t bg-[#8C5BFF]" style={{ height: `${Math.max(0, Math.min(100, Math.abs(row.income) / max * 100))}%` }} />
                <div className="w-1/2 rounded-t bg-[#4B2CFF]" style={{ height: `${Math.max(0, Math.min(100, Math.abs(row.expense) / max * 100))}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{row.month.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>Receitas (lilás) · Despesas (roxo)</span>
          <span>{hidden ? "Valores ocultos" : `Saldo do último mês: ${money(data.monthly_history.at(-1)?.net ?? 0)}`}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </section>
  );
}
