import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CalendarClock, CreditCard, GitCompareArrows, Pause, Pencil, Play, Plus, Radar, Repeat, Search, Trash2, Wallet } from "lucide-react";
import { createSubscription, deleteSubscription, updateSubscription } from "@/lib/data";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL, todayISO } from "@/lib/format";
import { daysUntil, fluxoSubscriptions, monthlyCost, seedFromTransaction, toInput, whenLabel, type FluxoSubscription } from "@/lib/subscriptionsView";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import SubscriptionEditor from "@/components/subscriptions/SubscriptionEditor";
import type { Account, CreditCard as Card, RadarSignal, SubscriptionInput, SubscriptionItem, Subscriptions, Transaction } from "@/types/finnos";

type Filter = "todas" | "ativas" | "pausadas" | "fluxo";
type Row =
  | { kind: "sub"; id: string; item: SubscriptionItem; fluxo?: FluxoSubscription; next: string; active: boolean; name: string }
  | { kind: "fluxo"; id: string; entry: FluxoSubscription; next: string; active: true; name: string };

const norm = (text: string) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Central de assinaturas: the plans registered here plus the subscription expenses already in Fluxo,
 * in one list, with what each costs, when it charges and where.
 */
export function SubscriptionsPanel({ data, transactions, accounts, cards, candidates }: {
  data: Subscriptions;
  transactions: Transaction[];
  accounts: Account[];
  cards: Card[];
  candidates: RadarSignal[];
}) {
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
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Conta";
  const cardName = (id: string | null) => (id ? cards.find((c) => c.id === id)?.name ?? "Cartão" : null);

  const fluxo = useMemo(() => fluxoSubscriptions(transactions, data.items, today), [transactions, data.items, today]);
  const rows = useMemo<Row[]>(() => [
    ...data.items.map((item): Row => ({ kind: "sub", id: item.id, item, fluxo: fluxo.matched.get(item.id), next: item.next_charge, active: item.active, name: item.name })),
    ...fluxo.onlyInFluxo.map((entry): Row => ({ kind: "fluxo", id: `fluxo:${entry.key}`, entry, next: entry.nextCharge, active: true, name: entry.name })),
  ], [data.items, fluxo]);

  // Totals count both: what is registered here and what Fluxo shows being charged every month.
  const fluxoMonthly = fluxo.onlyInFluxo.reduce((sum, entry) => sum + entry.value, 0);
  const monthly = data.monthly_total + fluxoMonthly;
  // Income of the month as Fluxo shows it, so the share counts Fluxo-only subscriptions too.
  const income = useMemo(() => transactions
    .filter((tx) => tx.type === "receita" && tx.status === "pago" && tx.date.slice(0, 7) === today.slice(0, 7))
    .reduce((sum, tx) => sum + tx.value, 0), [transactions, today]);
  const activeCount = rows.filter((row) => row.active).length;
  const upcoming = rows
    .filter((row) => row.active && daysUntil(row.next, today) <= 30)
    .map((row) => ({ row, days: daysUntil(row.next, today), value: row.kind === "sub" ? row.item.value : row.entry.value }))
    .sort((a, b) => a.days - b.days);
  const upcomingTotal = upcoming.reduce((sum, u) => sum + u.value, 0);

  const known = useMemo(() => rows.map((row) => norm(row.name)), [rows]);
  const suggestions = useMemo(
    () => candidates.filter((signal) => !known.some((name) => name && norm(signal.description).includes(name))),
    [candidates, known],
  );
  const visible = useMemo(() => {
    const term = norm(search);
    return rows
      .filter((row) => filter === "todas" || (filter === "ativas" ? row.active : filter === "pausadas" ? !row.active : row.kind === "fluxo"))
      .filter((row) => !term || norm(row.name).includes(term))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.next.localeCompare(b.next));
  }, [rows, filter, search]);

  const closeEditor = () => { setEditor(null); setError(""); };
  const follow = (tx: Transaction) => { setEditor({ seed: seedFromTransaction(tx, today) }); setError(""); };

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

  const fromRadar = (signal: RadarSignal) => {
    const tx = transactions.find((row) => row.id === signal.related_entity_id);
    setEditor({ seed: tx ? seedFromTransaction(tx, today) : {} });
  };

  // "Adicionar como assinatura" in a Radar signal lands here with ?novo=<signal id>.
  const [params, setParams] = useSearchParams();
  const pending = params.get("novo");
  useEffect(() => {
    if (!pending) return;
    const signal = candidates.find((item) => item.id === pending);
    if (!signal) return;
    setParams((current) => { const copy = new URLSearchParams(current); copy.delete("novo"); return copy; }, { replace: true });
    fromRadar(signal);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, candidates]);

  // The form replaces the list: start it at the top, not where the tapped row was.
  useEffect(() => { if (editor) window.scrollTo({ top: 0 }); }, [editor]);

  if (editor) {
    return <SubscriptionEditor key={editor.original?.id ?? "new"} original={editor.original} seed={editor.seed} saving={saving} error={error} onClose={closeEditor} onSave={persist} />;
  }

  const newButton = (
    <button type="button" onClick={() => { setEditor({}); setSelectedId(null); setError(""); }} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="new-subscription-button">
      <Plus className="h-4 w-4" aria-hidden="true" /> Nova assinatura
    </button>
  );

  return (
    <div className="space-y-5" data-testid="subscriptions-panel">
      {rows.length === 0 ? (
        <EmptyState icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma assinatura por aqui"
          description="Lançamentos na categoria Assinaturas aparecem aqui sozinhos. Você também pode cadastrar streaming, música, academia ou outro serviço."
          action={newButton} />
      ) : (
        <>
          <section className="overflow-hidden rounded-[24px] bg-navy p-5 text-white sm:p-6" data-testid="subscriptions-hero">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-white/70">Você paga por mês</p>
                <p className="mt-1 font-heading text-3xl font-bold tabular-nums sm:text-4xl" data-testid="subscriptions-monthly">{money(monthly)}</p>
                <p className="mt-1 text-sm text-white/70">{money(monthly * 12)} por ano · {activeCount} {activeCount === 1 ? "ativa" : "ativas"}</p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10"><Repeat className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-sm">
              <div><p className="text-xs text-white/60">Cadastradas</p><p className="mt-0.5 font-semibold tabular-nums" data-testid="subscriptions-registered">{money(data.monthly_total)}<span className="text-xs font-normal text-white/60">/mês</span></p></div>
              <div><p className="text-xs text-white/60">Só no Fluxo</p><p className="mt-0.5 font-semibold tabular-nums">{money(fluxoMonthly)}<span className="text-xs font-normal text-white/60">/mês</span></p></div>
              <div><p className="text-xs text-white/60">Da renda</p><p className="mt-0.5 font-semibold tabular-nums" data-testid="subscriptions-percent">{income > 0 ? `${Math.round((monthly / income) * 100)}%` : "—"}</p></div>
            </div>
          </section>

          {upcoming.length > 0 ? (
            <section aria-labelledby="subs-upcoming" data-testid="subscriptions-upcoming">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 id="subs-upcoming" className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><CalendarClock className="h-4 w-4" aria-hidden="true" />Próximas cobranças · 30 dias</h2>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{money(upcomingTotal)}</span>
              </div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
                {upcoming.map(({ row, days, value }) => (
                  <button key={row.id} type="button" onClick={() => { setFilter("todas"); setSearch(""); setSelectedId(row.id); setConfirmDelete(false); }} className={cn("w-36 shrink-0 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/50", days < 0 ? "border-expense/40" : "border-border")}>
                    <p className={cn("text-xs font-semibold", days < 0 ? "text-expense" : days <= 3 ? "text-primary" : "text-muted-foreground")}>{whenLabel(days)}</p>
                    <p className="mt-1 truncate text-sm font-semibold">{row.name}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">{money(value)}</p>
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
          <p className="mt-1 text-xs text-muted-foreground">Estão em outras categorias. Confirme os que são assinaturas.</p>
          <ul className="mt-3 space-y-2">
            {suggestions.slice(0, 4).map((signal) => (
              <li key={signal.id} className="flex items-center gap-3 rounded-xl bg-card p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{signal.description}</span>
                  {signal.metric ? <span className="block text-xs text-muted-foreground">média {signal.metric}</span> : null}
                </span>
                <Link to={`/radar/${signal.id}`} className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground">Detalhes</Link>
                <button type="button" onClick={() => fromRadar(signal)} className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">Adicionar</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="-mx-4 flex max-w-full gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist" aria-label="Filtrar assinaturas">
              {([
                ["todas", "Todas", rows.length],
                ["ativas", "Ativas", activeCount],
                ["pausadas", "Pausadas", rows.length - activeCount],
                ["fluxo", "Só no Fluxo", fluxo.onlyInFluxo.length],
              ] as const).filter(([key, , count]) => key === "todas" || count > 0).map(([key, label, count]) => (
                <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} data-testid={`subscriptions-filter-${key}`}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors", filter === key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                  {label}<span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>
            {rows.length > 5 ? (
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" className="h-9 rounded-full pl-9" aria-label="Buscar assinatura" data-testid="subscriptions-search-input" />
              </div>
            ) : null}
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" data-testid="subscriptions-list">
            {visible.map((row, index) => {
              const open = selectedId === row.id;
              const days = daysUntil(row.next, today);
              const color = (row.kind === "sub" ? row.item.category_color : row.entry.categoryColor) ?? "#4B2CFF";
              const where = row.kind === "sub" ? row.item.card_name ?? row.item.account_name : cardName(row.entry.cardId) ?? accountName(row.entry.accountId);
              const onCard = row.kind === "sub" ? Boolean(row.item.card_id) : Boolean(row.entry.cardId);
              const value = row.kind === "sub" ? row.item.value : row.entry.value;
              return (
                <motion.li key={row.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index, 8) * 0.02 }} data-testid={`subscription-item-${row.id}`}>
                  <button type="button" onClick={() => { setSelectedId(open ? null : row.id); setConfirmDelete(false); setError(""); }}
                    className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50", !row.active && "opacity-60")} aria-expanded={open}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${color}1A`, color }}>
                      <CategoryIcon name="repeat" className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{row.name}</span>
                        {row.kind === "fluxo" ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground">No Fluxo</span> : null}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {onCard ? <CreditCard className="h-3 w-3 shrink-0" aria-hidden="true" /> : <Wallet className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        <span className="truncate">{where} · {row.active ? `cobra ${whenLabel(days)}` : "pausada"}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-heading font-semibold tabular-nums" data-testid={`subscription-value-${row.id}`}>{money(value)}</span>
                      <span className="block text-xs text-muted-foreground">{row.kind === "sub" && row.item.recurrence === "anual" ? `anual · ${money(monthlyCost(row.item))}/mês` : "por mês"}</span>
                    </span>
                  </button>
                  {open && row.kind === "fluxo" ? (
                    <div className="space-y-3 bg-muted/30 px-4 py-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Último lançamento</dt><dd>{formatDate(row.entry.lastDate)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Lançamentos no Fluxo</dt><dd>{row.entry.count}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Próxima prevista</dt><dd>{formatDate(row.entry.nextCharge)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Custo no ano</dt><dd className="tabular-nums">{money(row.entry.value * 12)}</dd></div>
                      </dl>
                      <p className="text-xs text-muted-foreground">Encontrada nos lançamentos da categoria {row.entry.categoryName ?? "Assinaturas"}. Acompanhe aqui para guardar a data da cobrança, pausar e receber lembretes.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => follow(row.entry.last)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground" data-testid={`subscription-follow-${row.entry.key}`}><Plus className="h-4 w-4" aria-hidden="true" /> Acompanhar aqui</button>
                        <Link to={row.entry.categoryId ? `/fluxo?metric=despesas&category_id=${encodeURIComponent(row.entry.categoryId)}` : "/fluxo?metric=despesas"} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium"><GitCompareArrows className="h-4 w-4" aria-hidden="true" /> Ver no Fluxo</Link>
                      </div>
                    </div>
                  ) : null}
                  {open && row.kind === "sub" ? (
                    <div className="space-y-3 bg-muted/30 px-4 py-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Próxima cobrança</dt><dd>{formatDate(row.item.next_charge)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Categoria</dt><dd>{row.item.category_name || "Sem categoria"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Cobrada em</dt><dd>{row.item.card_id ? <Link to={`/cartoes/${row.item.card_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{row.item.card_name}</Link> : row.item.account_name}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Custo no ano</dt><dd className="tabular-nums">{money(monthlyCost(row.item) * 12)}</dd></div>
                        {row.fluxo ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">No Fluxo</dt><dd>{row.fluxo.count} {row.fluxo.count === 1 ? "lançamento" : "lançamentos"} · último em {formatDate(row.fluxo.lastDate)} de {money(row.fluxo.value)}</dd></div> : null}
                      </dl>
                      {row.item.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.item.notes}</p> : null}
                      {!confirmDelete ? (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => { setEditor({ original: row.item }); setError(""); }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium"><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</button>
                          <button type="button" disabled={saving} onClick={() => void toggleActive(row.item)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium disabled:opacity-50" data-testid={`subscription-toggle-${row.item.id}`}>
                            {row.item.active ? <><Pause className="h-4 w-4" aria-hidden="true" /> Pausar</> : <><Play className="h-4 w-4" aria-hidden="true" /> Reativar</>}
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir</button>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-destructive/30 bg-card p-3 text-sm">
                          <p className="font-semibold">Excluir “{row.item.name}”?</p>
                          <p className="mt-1 text-muted-foreground">Só o cadastro sai. Os lançamentos já feitos continuam no Fluxo. Se quiser parar de contar por um tempo, use Pausar.</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={saving} onClick={() => void remove(row.item)} className="rounded-full bg-destructive px-4 py-2 font-semibold text-destructive-foreground disabled:opacity-50">Confirmar exclusão</button>
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
            {visible.length === 0 ? <li className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="subscriptions-no-results">{search ? "Nenhuma assinatura com esse nome." : "Nada neste filtro."}</li> : null}
          </ul>
        </section>
      ) : null}

      {rows.length > 0 ? <div className="flex justify-center">{newButton}</div> : null}
      <p className="text-xs text-muted-foreground">Cadastrar uma assinatura não cria lançamento: as cobranças reais continuam no Fluxo e na fatura do cartão. Lançamentos na categoria Assinaturas aparecem aqui automaticamente.</p>
    </div>
  );
}
