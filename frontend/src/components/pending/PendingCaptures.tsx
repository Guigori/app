import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import type { RegisterController } from "@/pages/SmartRegister";
import { RegisterSuccess } from "@/components/transactions/RegisterSuccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, CreditCard, Landmark, Loader2, Pencil, ReceiptText, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import {
  confirmAllPendingCaptures, confirmPendingCapture, discardPendingCapture, fetchAccounts, fetchCards, fetchCategories,
  fetchPendingCaptures, keepAutoCapture, undoAutoCapture,
} from "@/lib/data";
import { getMode } from "@/lib/mode";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import {
  asksDebitOrCredit, choiceSummary, confirmBody, initialChoice, needsWallet,
  orderForReview, readyToRegister, refusalMessage, waitingLabel, type CaptureChoice,
} from "@/lib/pendingCaptures";
import { cn } from "@/lib/utils";
import type { Account, AutoRegisteredCapture, Category, CreditCard as Card_, PaymentMethod, PendingCapture } from "@/types/finnos";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";

const SmartRegister = lazy(() => import("@/pages/SmartRegister"));

/** Keys that change when a purchase becomes a lançamento (or goes away). */
const REFRESH = ["pending-captures", "notifications", "transactions", "accounts", "dashboard", "cards", "flow", "calendar", "radar"];

interface Lists { accounts: Account[]; cards: Card_[]; categories: Category[] }

/** "Editar": the same register screens as a manual entry, prefilled with the purchase; ✓ confirms it. */
function CaptureEditor({ item, choice, onClose }: { item: PendingCapture; choice: CaptureChoice; onClose: () => void }) {
  const [controller, setController] = useState<RegisterController | null>(null);
  const showCheck = controller?.view === "entry";
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background" role="dialog" aria-modal="true" aria-label="Editar compra do Apple Pay" data-testid="pending-capture-sheet">
      <div className="relative mx-auto h-full max-w-md">
        <div className="h-full pb-24">
          <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Preparando…</div>}>
            <SmartRegister embedded capture={{ item, choice }} onClose={onClose} onController={setController} />
          </Suspense>
        </div>
        {controller && controller.view !== "success" ? (
          <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-3">
            <button type="button" onClick={onClose} aria-label="Fechar sem confirmar" className="grid h-12 w-12 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md"><X className="h-5 w-5" aria-hidden="true" /></button>
            {showCheck ? (
              <button type="button" onClick={() => (controller.canSave && !controller.saving ? controller.save() : toast(controller.hint ?? "Escolha categoria e conta"))} aria-label="Confirmar compra" data-testid="pending-capture-register"
                className="grid h-[4.15rem] w-[4.15rem] place-items-center rounded-full bg-expense text-white shadow-lg active:scale-95">
                {controller.saving ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /> : <Check className="h-8 w-8" aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>, document.body);
}

/** One purchase in one short card: what will be registered, and two buttons. */
function Row({ item, lists }: { item: PendingCapture; lists: Lists }) {
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const [choice, setChoice] = useState<CaptureChoice>(() => initialChoice(item));
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [success, setSuccess] = useState<{ amount: string; chips: string[] } | null>(null);
  const refresh = () => Promise.all(REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  // A card or account registered meanwhile becomes the suggestion, unless the person already picked one.
  useEffect(() => {
    setChoice((c) => ({
      ...c,
      accountId: c.accountId || item.suggested_account_id || "",
      cardId: c.cardId || item.suggested_card_id || "",
      categoryId: c.categoryId || item.suggested_category_id || "",
    }));
  }, [item.suggested_account_id, item.suggested_card_id, item.suggested_category_id]);

  // `as` registers with that method right away (the débito/crédito buttons of an ambiguous name).
  const register = useMutation({
    mutationFn: (as?: PaymentMethod) => confirmPendingCapture(item.id, confirmBody(as ? { ...choice, method: as, installments: as === "debito" ? 1 : choice.installments } : choice)),
    onSuccess: async (_, as) => {
      setEditing(false);
      const method = (as ?? choice.method) === "credito" ? "Crédito" : "Débito";
      const wallet = method === "Crédito" ? lists.cards.find((c) => c.id === choice.cardId)?.name : lists.accounts.find((a) => a.id === choice.accountId)?.name;
      const category = lists.categories.find((c) => c.id === choice.categoryId)?.name;
      // Same animated screen as a manual register; the list refreshes when it closes.
      setSuccess({ amount: formatBRL(item.value).replace(/,00$/, ""), chips: [category, wallet ? `${method} · ${wallet}` : method, "Apple Pay"].filter(Boolean) as string[] });
    },
    // The server explains refusals in plain Portuguese ("cartão sem conta de pagamento", ...).
    onError: (error) => toast.error(refusalMessage(error, "Não foi possível registrar. A compra continua pendente.")),
  });
  const discard = useMutation({
    mutationFn: () => discardPendingCapture(item.id),
    onSuccess: async () => { setDiscarding(false); setEditing(false); toast.success("Compra excluída."); await refresh(); },
    onError: (error) => { setDiscarding(false); toast.error(refusalMessage(error, "Não foi possível excluir. Tente de novo.")); },
  });

  if (item.is_test) {
    return (
      <li className="flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-background/70 p-3" data-testid="pending-capture-test">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{item.name}</p>
          <p className="text-xs text-muted-foreground">O Apple Pay já fala com o FINNOS. É só um teste.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => discard.mutate()} disabled={discard.isPending} data-testid="pending-capture-discard-test">
          <Trash2 className="h-4 w-4" aria-hidden="true" />Excluir
        </Button>
      </li>
    );
  }

  const closeSuccess = () => { setSuccess(null); void refresh(); };
  const summary = choiceSummary(choice, lists.accounts, lists.cards, lists.categories);
  const MethodIcon = choice.method === "credito" ? CreditCard : Landmark;
  // "Nubank" is both an account and a card: ask, with both answers one tap away.
  const ask = asksDebitOrCredit(item);
  const accountName = lists.accounts.find((a) => a.id === choice.accountId)?.name;
  const cardName = lists.cards.find((c) => c.id === choice.cardId)?.name;
  const categoryName = lists.categories.find((c) => c.id === choice.categoryId)?.name;

  return (
    <li className="rounded-2xl border border-border bg-background/70 p-3" data-testid="pending-capture-item">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{item.name}</p>
        <p className="shrink-0 font-heading text-sm font-bold tabular-nums text-expense" data-testid="pending-capture-value">{money(item.value)}</p>
      </div>
      {ask ? (
        <>
          <p className="mt-0.5 text-xs font-medium text-foreground" data-testid="pending-capture-ask">
            Débito ou crédito? “{item.source_sent}” é conta e cartão.{categoryName ? <span className="font-normal text-muted-foreground"> · {categoryName}</span> : null}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Button type="button" variant="outline" size="sm" className="min-w-0" onClick={() => register.mutate("debito")} disabled={register.isPending} data-testid="pending-capture-ask-debito">
              <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Débito · {accountName}</span>
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-w-0" onClick={() => register.mutate("credito")} disabled={register.isPending} data-testid="pending-capture-ask-credito">
              <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Crédito · {cardName}</span>
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">
              {waitingLabel(item) ? <span className="font-semibold text-amber-700 dark:text-amber-400" data-testid="pending-capture-stale">{waitingLabel(item)}</span> : formatDate(item.date)}
            </p>
            <button type="button" className="shrink-0 text-xs font-semibold text-primary" onClick={() => setEditing(true)} data-testid="pending-capture-edit">Parcelas, categoria…</button>
          </div>
        </>
      ) : (
        <>
          <p className={cn("mt-0.5 flex items-center gap-1 text-xs", summary.missing ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")} data-testid="pending-capture-summary">
            {summary.missing ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <MethodIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{summary.text}</span>
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">
              {waitingLabel(item)
                ? <span className="font-semibold text-amber-700 dark:text-amber-400" data-testid="pending-capture-stale">{waitingLabel(item)}</span>
                : formatDate(item.date)}
            </p>
            <div className="flex shrink-0 gap-1.5">
              <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label="Excluir compra" onClick={() => setDiscarding(true)} data-testid="pending-capture-discard"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="pending-capture-edit">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{summary.missing ? "Completar" : "Editar"}
              </Button>
              {!summary.missing ? (
                <Button type="button" size="sm" onClick={() => register.mutate(undefined)} disabled={register.isPending} data-testid="pending-capture-quick-register">
                  {register.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}Confirmar
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}

      {success && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[60] bg-background" data-testid="pending-capture-success">
          <div className="mx-auto h-full max-w-md">
            <RegisterSuccess kind="Despesa" amount={success.amount} name={item.name} chips={success.chips} onAnother={closeSuccess} onView={closeSuccess} onDone={closeSuccess} />
          </div>
        </div>, document.body) : null}
      {editing ? <CaptureEditor item={item} choice={choice} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Excluir esta compra?"
        description={`${item.name} (${money(item.value)}) não será registrada no FINNOS.`}
        confirmLabel="Excluir"
        destructive
        loading={discard.isPending}
        onConfirm={() => discard.mutate()}
      />
    </li>
  );
}

/** A purchase FINNOS registered automatically: the person confirms it or takes it back. */
function AutoRow({ entry, categories }: { entry: AutoRegisteredCapture; categories: Category[] }) {
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const refresh = () => Promise.all(REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const undo = useMutation({
    mutationFn: () => undoAutoCapture(entry.id),
    onSuccess: async () => { toast.success("Desfeito. A compra voltou para revisão."); await refresh(); },
    onError: (error) => toast.error(refusalMessage(error, "Não foi possível desfazer agora.")),
  });
  const keep = useMutation({
    mutationFn: () => keepAutoCapture(entry.id),
    onSuccess: refresh,
    onError: (error) => toast.error(refusalMessage(error, "Não foi possível agora.")),
  });
  const category = categories.find((c) => c.id === entry.category_id)?.name;
  return (
    <li className="py-2.5" data-testid="pending-auto-item">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{entry.name}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-expense">{hidden ? formatHiddenBRL() : formatBRL(entry.value)}</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {entry.unusual ? <span className="font-semibold text-amber-700 dark:text-amber-400" data-testid="pending-auto-unusual">Valor alto · </span> : null}
          Débito{entry.account_name ? ` · ${entry.account_name}` : ""}{category ? ` · ${category}` : ""}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => undo.mutate()} disabled={undo.isPending || keep.isPending} data-testid="pending-auto-undo">
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />Desfazer
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => keep.mutate()} disabled={undo.isPending || keep.isPending} data-testid="pending-auto-keep">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />Certo
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Purchases from Apple Pay waiting for review, and the ones FINNOS registered automatically.
 * `limit` keeps Início short (the rest is in Fluxo); without it, every purchase is listed.
 * Shows nothing when there is nothing to review.
 */
export function PendingCaptures({ limit }: { limit?: number } = {}) {
  const enabled = getMode() === "account";
  const pending = useQuery({
    queryKey: ["pending-captures"],
    queryFn: fetchPendingCaptures,
    enabled,
    // A purchase made seconds ago must show when the person comes back from Wallet.
    staleTime: 10_000,
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled, staleTime: 30_000 });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled, staleTime: 30_000 });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled, staleTime: 60_000 });
  const [showAuto, setShowAuto] = useState(false);

  const queryClient = useQueryClient();
  const registerAll = useMutation({
    mutationFn: confirmAllPendingCaptures,
    onSuccess: async (result) => {
      if (result.registered > 0) toast.success(result.registered === 1 ? "1 compra registrada no débito." : `${result.registered} compras registradas no débito.`);
      if (result.failed.length > 0) toast.error(`${result.failed[0].name}: ${result.failed[0].detail}`);
      await Promise.all(REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => toast.error(refusalMessage(error, "Não foi possível registrar agora. As compras continuam pendentes.")),
  });

  const all = orderForReview(pending.data?.items ?? []);
  const auto = pending.data?.auto ?? [];
  if (!enabled || (all.length === 0 && auto.length === 0)) return null;
  const items = limit ? all.slice(0, limit) : all;
  const hiddenCount = all.length - items.length;
  const unknown = needsWallet(all);
  const ready = readyToRegister(all);
  const lists: Lists = { accounts: accounts.data ?? [], cards: cards.data ?? [], categories: categories.data ?? [] };

  return (
    <section className="rounded-3xl border border-primary/20 bg-primary/5 p-4" aria-labelledby="pending-captures-title" data-testid="pending-captures">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><ReceiptText className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="pending-captures-title" className="font-heading text-base font-semibold text-foreground">
            {all.length === 0 ? "Compras do Apple Pay" : all.length === 1 ? "1 compra para revisar" : `${all.length} compras para revisar`}
          </h2>
          {all.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Do Apple Pay, ainda fora do saldo.{unknown > 0 ? ` ${unknown === 1 ? "1 precisa" : `${unknown} precisam`} de conta ou cartão.` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="mt-3 space-y-2" data-testid="pending-captures-list">
          {items.map((item) => <Row key={item.id} item={item} lists={lists} />)}
        </ul>
      ) : null}

      {hiddenCount > 0 || ready >= 2 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {hiddenCount > 0 ? (
            <Link to="/transacoes" className="inline-flex items-center gap-1 text-sm font-semibold text-primary" data-testid="pending-captures-see-all">
              Ver todas as {all.length}<ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : <span />}
          {ready >= 2 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => registerAll.mutate()} disabled={registerAll.isPending} data-testid="pending-captures-register-all">
              {registerAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Registrar {ready} no débito
            </Button>
          ) : null}
        </div>
      ) : null}

      {auto.length > 0 ? (
        <div className={cn("rounded-2xl border border-border bg-background/70", all.length > 0 ? "mt-3" : "mt-3")} data-testid="pending-auto">
          <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" onClick={() => setShowAuto((v) => !v)} aria-expanded={showAuto} data-testid="pending-auto-toggle">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate"><strong className="font-semibold">{auto.length === 1 ? "1 registrada automaticamente" : `${auto.length} registradas automaticamente`}</strong></span>
            </span>
            <span className="flex shrink-0 items-center text-primary" aria-label={showAuto ? "Fechar" : "Conferir"}>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showAuto && "rotate-180")} aria-hidden="true" />
            </span>
          </button>
          {showAuto ? (
            <ul className="divide-y divide-border border-t border-border px-3" data-testid="pending-auto-list">
              {(limit ? auto.slice(0, limit) : auto).map((entry) => <AutoRow key={entry.id} entry={entry} categories={lists.categories} />)}
            </ul>
          ) : null}
          {showAuto ? (
            <Link to="/transacoes?origem=apple-pay-auto" className="block border-t border-border px-3 py-2 text-xs font-semibold text-primary" data-testid="pending-auto-see-all">
              Ver todas as automáticas no Fluxo
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
