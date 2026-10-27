import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Pencil, Plus, Repeat, Search, Trash2 } from "lucide-react";
import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
  updateSubscription,
} from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import SubscriptionEditor from "@/components/subscriptions/SubscriptionEditor";
import type { SubscriptionInput, SubscriptionItem } from "@/types/finnos";

export default function Subscriptions() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SubscriptionItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { hidden } = useBalanceHidden();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions });
  const data = query.data;
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const selected = data?.items.find(item => item.id === selectedId) ?? null;

  const items = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.items ?? []).filter(item =>
      !term || item.name.toLocaleLowerCase("pt-BR").includes(term)
    );
  }, [data, search]);

  const closeEditor = () => {
    setCreating(false);
    setEditing(null);
    setError("");
  };

  async function persist(input: SubscriptionInput) {
    setSaving(true);
    setError("");
    try {
      const result = editing
        ? await updateSubscription(editing.id, input)
        : await createSubscription(input);
      setSelectedId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      closeEditor();
    } catch (error) {
      if (!editing && error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        toast.info("Assinatura salva neste aparelho", {
          description: "Cadastro aguardando sincronização, ainda não confirmado no servidor.",
        });
        closeEditor();
      } else {
        setError("Não foi possível salvar a assinatura. Verifique a conta, o cartão e a conexão.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!selected || !confirmDelete || saving) return;
    setSaving(true);
    setError("");
    try {
      await deleteSubscription(selected.id);
      setSelectedId(null);
      setConfirmDelete(false);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    } catch {
      setError("Não foi possível excluir esta assinatura. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Assinaturas</h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="subscriptions-subtitle">
            Serviços que você assinou, com valores, próximas cobranças e estimativa anual.
          </p>
        </div>
        {!creating && !editing && (
          <button type="button" onClick={() => { setCreating(true); setSelectedId(null); setError(""); }}
            className="inline-flex items-center gap-2 rounded-full bg-[#4B2CFF] px-4 py-2.5 text-sm font-semibold text-white">
            <Plus size={18} /> Nova assinatura
          </button>
        )}
      </div>

      {(creating || editing) && (
        <SubscriptionEditor key={editing?.id ?? "new"} original={editing}
          saving={saving} error={error} onClose={closeEditor} onSave={persist} />
      )}

      {!creating && !editing && (query.isPending ? (
        <FinnosPageLoading title="Carregando assinaturas" description="Conferindo seus serviços cadastrados." />
      ) : query.isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-card p-5">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar suas assinaturas.</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-full border border-border px-4 py-2 text-sm">Tentar novamente</button>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma assinatura cadastrada"
          description="Adicione Netflix, Spotify ou outro serviço. Despesas fixas e transferências não entram automaticamente nesta lista." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custo mensal equivalente</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-monthly">{money(data.monthly_total)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custo anual estimado</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-yearly">{money(data.yearly_total)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Da sua renda realizada no mês</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground" data-testid="subscriptions-percent">{data.income_percent > 0 ? `${data.income_percent}%` : "—"}</p>
              <p className="text-xs text-muted-foreground">Somente assinaturas ativas entram no cálculo.</p>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar assinatura…" className="pl-9" aria-label="Buscar assinatura" data-testid="subscriptions-search-input" />
          </div>

          <ul className="space-y-2.5" data-testid="subscriptions-list">
            {items.map((item, index) => (
              <motion.li key={item.id} initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden rounded-2xl border border-border bg-card"
                data-testid={`subscription-item-${item.id}`}>
                <button type="button" onClick={() => { setSelectedId(selectedId === item.id ? null : item.id); setConfirmDelete(false); setError(""); }}
                  className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={selectedId === item.id}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${item.category_color ?? "#5B3FE4"}1A`, color: item.category_color ?? "#5B3FE4" }}>
                    <CategoryIcon name="repeat" className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.card_name ?? item.account_name} · próxima cobrança {formatDate(item.next_charge)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-heading text-base font-bold tabular-nums text-foreground" data-testid={`subscription-value-${item.id}`}>{money(item.value)}</span>
                    <Badge variant="secondary" className="mt-0.5 text-[10px] capitalize">{item.active ? item.recurrence : "Pausada"}</Badge>
                  </span>
                </button>
                {selectedId === item.id && (
                  <div className="space-y-3 border-t border-border px-4 py-4">
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p><span className="text-muted-foreground">Categoria:</span> {item.category_name || "Sem categoria"}</p>
                      <p><span className="text-muted-foreground">Conta:</span> {item.account_name}</p>
                      <p><span className="text-muted-foreground">Cartão:</span> {item.card_name || "Não informado"}</p>
                      <p><span className="text-muted-foreground">Periodicidade:</span> {item.recurrence}</p>
                      <p><span className="text-muted-foreground">Status:</span> {item.active ? "Ativa" : "Pausada"}</p>
                      <p><span className="text-muted-foreground">Próxima cobrança:</span> {formatDate(item.next_charge)}</p>
                    </div>
                    {item.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>}
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => { setEditing(item); setError(""); }}
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium">
                        <Pencil size={15} /> Editar
                      </button>
                      {!confirmDelete ? (
                        <button type="button" onClick={() => setConfirmDelete(true)}
                          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-destructive">
                          <Trash2 size={15} /> Excluir
                        </button>
                      ) : (
                        <div className="w-full rounded-2xl border border-destructive/30 p-3 text-sm">
                          <p className="font-semibold">Excluir “{item.name}”?</p>
                          <p className="mt-1 text-muted-foreground">Apenas o cadastro da assinatura será excluído. Transações anteriores permanecem intactas.</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={saving} onClick={() => void removeSelected()}
                              className="rounded-full bg-destructive px-4 py-2 font-semibold text-destructive-foreground disabled:opacity-50">Confirmar exclusão</button>
                            <button type="button" onClick={() => setConfirmDelete(false)}
                              className="rounded-full border border-border px-4 py-2">Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  </div>
                )}
              </motion.li>
            ))}
            {items.length === 0 && <li className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="subscriptions-no-results">Nenhuma assinatura com esse nome.</li>}
          </ul>
        </>
      ))}

      <p className="text-xs text-muted-foreground">O cadastro de uma assinatura é informativo: nenhum lançamento financeiro é criado automaticamente. Despesas fixas anteriores permanecem no Fluxo.</p>
    </div>
  );
}
