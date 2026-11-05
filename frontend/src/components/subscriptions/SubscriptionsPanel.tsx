import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CalendarClock, CreditCard, Pause, Pencil, Play, Plus, Radar, Repeat, Search, Trash2, Wallet } from "lucide-react";
import { createSubscription, deleteSubscription, fetchTransactions, updateSubscription } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL, todayISO } from "@/lib/format";
import { monthlyCost, seedFromTransaction, toInput, upcomingCharges, whenLabel } from "@/lib/subscriptionsView";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import SubscriptionEditor from "@/components/subscriptions/SubscriptionEditor";
import type { RadarSignal, SubscriptionInput, SubscriptionItem, Subscriptions } from "@/types/finnos";

type Filter = "todas" | "ativas" | "pausadas";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "ativas", label: "Ativas" },
  { key: "pausadas", label: "Pausadas" },
];

const norm = (text: string) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** The Assinaturas tab of Carteira: what is charged, when, on which card, and what the Radar found. */
export function SubscriptionsPanel({ data, candidates }: { data: Subscriptions; candidates: RadarSignal[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ original?: SubscriptionItem; seed?: Partial<SubscriptionInput> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { hidden } = useBalanceHidden();
  const queryClient = useQueryClient();
  const money = (value: number) => (hidden ? formatHiddenBRL() : formatBRL(value));
  const today = todayISO();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
    queryClient.invalidateQueries({ queryKey: ["radar"] }),
  ]);

  const upcoming = useMemo(() => upcomingCharges(data.items, today), [data.items, today]);
  const upcomingTotal = upcoming.reduce((sum, row) => sum + row.item.value, 0);
  const pausedCount = data.items.filter((item) => !item.active).length;
  // A candidate whose name is already a subscription is not news.
  const known = useMemo(() => data.items.map((item) => norm(item.name)), [data.items]);
  const suggestions = useMemo(
    () => candidates.filter((signal) => !known.some((name) => name && norm(signal.description).includes(name))),
    [candidates, known],
  );
  const items = useMemo(() => {
    const term = norm(search);
    return data.items
      .filter((item) => filter === "todas" || (filter === "ativas" ? item.active : !item.active))
      .filter((item) => !term || norm(item.name).includes(term))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.next_charge.localeCompare(b.next_charge));
  }, [data.items, filter, search]);

  const closeEditor = () => { setEditor(null); setError(""); };

  async function persist(input: SubscriptionInput) {
    setSaving(true);
    setError("");
    try {
      const result = editor?.original ? await updateSubscription(editor.original.id, input) : await createSubscription(input);
      setSelectedId(result.id);
      await refresh();
      closeEditor();
    } catch (error) {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        toast.info("Assinatura salva neste aparelho", { description: "Cadastro aguardando sincronização, ainda não confirmado no servidor." });
        closeEditor();
      } else {
        setError("Não foi possível salvar a assinatura. Verifique a conta, o cartão e a conexão.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: SubscriptionItem) {
    setSaving(true);
    try {
      await updateSubscription(item.id, toInput(item, { active: !item.active }));
      toast.success(item.active ? `${item.name} pausada. Ela sai dos totais.` : `${item.name} reativada.`);
      await refresh();
    } catch (error) {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") toast.info("Alteração aguardando sincronização.");
      else toast.error("Não foi possível alterar esta assinatura.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: SubscriptionItem) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await deleteSubscription(item.id);
      setSelectedId(null);
      setConfirmDelete(false);
      await refresh();
    } catch (error) {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        toast.info("Exclusão da assinatura aguardando sincronização", { description: "A assinatura continuará no servidor até a confirmação." });
        setConfirmDelete(false);
      } else {
        setError("Não foi possível excluir esta assinatura. Tente novamente.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function addFromRadar(signal: RadarSignal) {
    try {
      const rows = await fetchTransactions({});
      const tx = rows.find((row) => row.id === signal.related_entity_id);
      setEditor({ seed: tx ? seedFromTransaction(tx, today) : {} });
    } catch {
      setEditor({ seed: {} });
    }
  }

  // "Adicionar como assinatura" in a Radar signal lands here with ?novo=<signal id>.
  const [params, setParams] = useSearchParams();
  const pending = params.get("novo");
  useEffect(() => {
    if (!pending) return;
    const signal = candidates.find((item) => item.id === pending);
    if (!signal) return;
    setParams((current) => { const copy = new URLSearchParams(current); copy.delete("novo"); return copy; }, { replace: true });
    void addFromRadar(signal);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, candidates]);

  if (editor) {
    return <SubscriptionEditor key={editor.original?.id ?? "new"} original={editor.original} seed={editor.seed} saving={saving} error={error} onClose={closeEditor} onSave={persist} />;
  }

  const newButton = (
    <button type="button" onClick={() => { setEditor({}); setSelectedId(null); setError(""); }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground" data-testid="new-subscription-button">
      <Plus className="h-4 w-4" aria-hidden="true" /> Nova assinatura
    </button>
  );

  return (
    <div className="space-y-5" data-testid="subscriptions-panel">
      {data.items.length === 0 ? (
        <EmptyState icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma assinatura cadastrada"
          description="Adicione streaming, música, academia ou outro serviço para ver quanto custa por mês, quando cobra e em qual cartão."
          action={newButton} />
      ) : (
        <>
          <section className="rounded-[24px] border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Assinaturas por mês</p>
                <p className="mt-1 font-heading text-3xl font-bold tabular-nums" data-testid="subscriptions-monthly">{money(data.monthly_total)}</p>
              </div>
              {newButton}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Por ano</p><p className="mt-0.5 font-semibold tabular-nums" data-testid="subscriptions-yearly">{money(data.yearly_total)}</p></div>
              <div><p className="text-xs text-muted-foreground">Da renda do mês</p><p className="mt-0.5 font-semibold tabular-nums" data-testid="subscriptions-percent">{data.income_percent > 0 ? `${data.income_percent}%` : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Ativas</p><p className="mt-0.5 font-semibold tabular-nums">{data.items.length - pausedCount} de {data.items.length}</p></div>
            </div>
          </section>

          {upcoming.length > 0 ? (
            <section aria-labelledby="subs-upcoming" data-testid="subscriptions-upcoming">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 id="subs-upcoming" className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><CalendarClock className="h-4 w-4" aria-hidden="true" />Próximos 30 dias</h2>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{money(upcomingTotal)}</span>
              </div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
                {upcoming.map(({ item, days }) => (
                  <button key={item.id} type="button" onClick={() => { setFilter("todas"); setSearch(""); setSelectedId(item.id); setConfirmDelete(false); }} className={cn("w-36 shrink-0 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/50", days < 0 ? "border-expense/40" : "border-border")}>
                    <p className={cn("text-xs font-semibold", days < 0 ? "text-expense" : days <= 3 ? "text-primary" : "text-muted-foreground")}>{whenLabel(days)}</p>
                    <p className="mt-1 truncate text-sm font-semibold">{item.name}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">{money(item.value)}</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {suggestions.length > 0 ? (
        <section className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4" data-testid="subscriptions-suggestions">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Radar className="h-4 w-4 text-primary" aria-hidden="true" />O Radar achou gastos que se repetem</h2>
          <p className="mt-1 text-xs text-muted-foreground">Confirme os que são assinaturas para acompanhar valor e data da cobrança.</p>
          <ul className="mt-3 space-y-2">
            {suggestions.slice(0, 4).map((signal) => (
              <li key={signal.id} className="flex items-center gap-3 rounded-xl bg-card p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{signal.description}</span>
                  {signal.metric ? <span className="block text-xs text-muted-foreground">média {signal.metric}</span> : null}
                </span>
                <Link to={`/radar/${signal.id}`} className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground">Detalhes</Link>
                <button type="button" onClick={() => void addFromRadar(signal)} className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">Adicionar</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.items.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full border border-border bg-muted/60 p-1" role="tablist" aria-label="Filtrar assinaturas">
              {FILTERS.map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)}
                  className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition-colors", filter === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {item.label}
                </button>
              ))}
            </div>
            {data.items.length > 5 ? (
              <div className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" className="h-9 rounded-full pl-9" aria-label="Buscar assinatura" data-testid="subscriptions-search-input" />
              </div>
            ) : null}
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" data-testid="subscriptions-list">
            {items.map((item, index) => {
              const open = selectedId === item.id;
              const days = Math.round((Date.parse(item.next_charge + "T12:00:00") - Date.parse(today + "T12:00:00")) / 86_400_000);
              return (
                <motion.li key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index, 8) * 0.02 }} data-testid={`subscription-item-${item.id}`}>
                  <button type="button" onClick={() => { setSelectedId(open ? null : item.id); setConfirmDelete(false); setError(""); }}
                    className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50", !item.active && "opacity-60")} aria-expanded={open}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${item.category_color ?? "#4B2CFF"}1A`, color: item.category_color ?? "#4B2CFF" }}>
                      <CategoryIcon name="repeat" className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {item.card_id ? <CreditCard className="h-3 w-3 shrink-0" aria-hidden="true" /> : <Wallet className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        <span className="truncate">{item.card_name ?? item.account_name} · {item.active ? `cobra ${whenLabel(days)}` : "pausada"}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-heading font-semibold tabular-nums" data-testid={`subscription-value-${item.id}`}>{money(item.value)}</span>
                      <span className="block text-xs text-muted-foreground">{item.recurrence === "anual" ? `anual · ${money(monthlyCost(item))}/mês` : "por mês"}</span>
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-3 bg-muted/30 px-4 py-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Próxima cobrança</dt><dd>{formatDate(item.next_charge)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Categoria</dt><dd>{item.category_name || "Sem categoria"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Cobrada em</dt><dd>{item.card_id ? <Link to={`/cartoes/${item.card_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{item.card_name}</Link> : item.account_name}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Custo no ano</dt><dd className="tabular-nums">{money(monthlyCost(item) * 12)}</dd></div>
                      </dl>
                      {item.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p> : null}
                      {!confirmDelete ? (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => { setEditor({ original: item }); setError(""); }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium"><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</button>
                          <button type="button" disabled={saving} onClick={() => void toggleActive(item)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium disabled:opacity-50" data-testid={`subscription-toggle-${item.id}`}>
                            {item.active ? <><Pause className="h-4 w-4" aria-hidden="true" /> Pausar</> : <><Play className="h-4 w-4" aria-hidden="true" /> Reativar</>}
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir</button>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-destructive/30 bg-card p-3 text-sm">
                          <p className="font-semibold">Excluir “{item.name}”?</p>
                          <p className="mt-1 text-muted-foreground">Só o cadastro sai. Os lançamentos já feitos continuam no Fluxo. Se quiser parar de contar por um tempo, use Pausar.</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={saving} onClick={() => void remove(item)} className="rounded-full bg-destructive px-4 py-2 font-semibold text-destructive-foreground disabled:opacity-50">Confirmar exclusão</button>
                            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-full border border-border px-4 py-2">Cancelar</button>
                          </div>
                        </div>
                      )}
                      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
            {items.length === 0 ? <li className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="subscriptions-no-results">{search ? "Nenhuma assinatura com esse nome." : filter === "pausadas" ? "Nenhuma assinatura pausada." : "Nenhuma assinatura ativa."}</li> : null}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">Assinaturas são um acompanhamento: nenhum lançamento é criado automaticamente. As cobranças reais seguem no Fluxo e na fatura do cartão.</p>
    </div>
  );
}
