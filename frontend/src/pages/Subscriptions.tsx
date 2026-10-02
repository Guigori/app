import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Repeat, Search } from "lucide-react";
import { fetchSubscriptions } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function Subscriptions() {
  const [search, setSearch] = useState("");
  const { hidden } = useBalanceHidden();
  const query = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const data = query.data;
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => !term || item.name.toLowerCase().includes(term));
  }, [data, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Assinaturas</h1>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="subscriptions-subtitle">
          Suas despesas fixas mensais — Netflix, Spotify, academia, internet — com custo mensal e estimativa anual.
        </p>
      </div>

      {query.isPending ? (
        <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-hidden="true" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma assinatura ainda"
          description="Marque uma despesa como “fixa mensal” ao registrá-la e ela aparece aqui automaticamente."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custo mensal</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-monthly">
                {money(data.monthly_total)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Estimativa anual</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-yearly">
                {money(data.yearly_total)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Da sua renda do mês</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-percent">
                {data.income_percent > 0 ? `${data.income_percent}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.income_percent > 0 ? "Comprometido com recorrências" : "Sem receita registrada no mês"}
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar assinatura…"
              className="pl-9"
              aria-label="Buscar assinatura"
              data-testid="subscriptions-search-input"
            />
          </div>

          <ul className="space-y-2.5" data-testid="subscriptions-list">
            {items.map((item, index) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
                data-testid={`subscription-item-${item.id}`}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    backgroundColor: `${item.category_color ?? "#5B3FE4"}1A`,
                    color: item.category_color ?? "#5B3FE4",
                  }}
                  aria-hidden="true"
                >
                  <CategoryIcon name="repeat" className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.category_name ?? "Sem categoria"} · {item.card_name ?? item.account_name} · próxima cobrança{" "}
                    {formatDate(item.next_charge)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-heading text-base font-bold tabular-nums text-foreground" data-testid={`subscription-value-${item.id}`}>
                    {money(item.value)}
                  </p>
                  <Badge variant="secondary" className="mt-0.5 text-[10px] capitalize">
                    {item.recurrence}
                  </Badge>
                </div>
              </motion.li>
            ))}
            {items.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="subscriptions-no-results">
                Nenhuma assinatura com esse nome.
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}
