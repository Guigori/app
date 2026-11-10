import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, CreditCard, Landmark, Loader2, Pencil, ReceiptText, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  confirmAllPendingCaptures, confirmPendingCapture, discardPendingCapture, fetchAccounts, fetchCards, fetchCategories,
  fetchPendingCaptures, keepAutoCapture, undoAutoCapture,
} from "@/lib/data";
import { getMode } from "@/lib/mode";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import {
  activeAccounts, activeCards, asksDebitOrCredit, canRegister, choiceSummary, confirmBody, initialChoice, invoiceFor, invoiceLabel, needsWallet,
  orderForReview, readyToRegister, refusalMessage, waitingLabel, type CaptureChoice,
} from "@/lib/pendingCaptures";
import { cn } from "@/lib/utils";
import type { Account, AutoRegisteredCapture, Category, CreditCard as Card_, PaymentMethod, PendingCapture } from "@/types/finnos";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CardDialog } from "@/components/cards/CardDialog";
import { AccountDialog } from "@/components/accounts/AccountDialog";

const FIELD = "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Keys that change when a purchase becomes a lançamento (or goes away). */
const REFRESH = ["pending-captures", "notifications", "transactions", "accounts", "dashboard", "cards", "flow", "calendar", "radar"];

const METHODS: { key: PaymentMethod; label: string; Icon: typeof Landmark }[] = [
  { key: "debito", label: "Débito", Icon: Landmark },
  { key: "credito", label: "Crédito", Icon: CreditCard },
];

interface Lists { accounts: Account[]; cards: Card_[]; categories: Category[] }

/** "Alterar": everything about one purchase, in a panel from the bottom of the screen. */
function EditSheet({
  item, choice, set, lists, open, onOpenChange, onRegister, registering, onDiscard,
}: {
  item: PendingCapture; choice: CaptureChoice; set: (patch: Partial<CaptureChoice>) => void; lists: Lists;
  open: boolean; onOpenChange: (open: boolean) => void; onRegister: () => void; registering: boolean; onDiscard: () => void;
}) {
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const [dialog, setDialog] = useState<"card" | "account" | null>(null);
  const credit = choice.method === "credito";
  const accounts = activeAccounts(lists.accounts);
  const cards = activeCards(lists.cards);
  const card = cards.find((c) => c.id === choice.cardId);
  const account = accounts.find((a) => a.id === choice.accountId);
  const invoice = credit && card ? invoiceFor(item.date, card) : null;
  const walletName = credit ? card?.name : account?.name;
  const missing = credit ? !card : !account;
  const sent = item.source_sent;
  // The usual screens save the card/account themselves; closing them re-checks this purchase.
  const closeDialog = (next: boolean) => {
    if (next) return;
    setDialog(null);
    void Promise.all(["pending-captures", "cards", "accounts"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-lg" data-testid="pending-capture-sheet">
        <SheetHeader className="px-5 pt-5 pb-3 text-left">
          <SheetTitle className="pr-8 font-heading text-lg">{item.name}</SheetTitle>
          <SheetDescription>
            <span className="font-heading text-xl font-bold tabular-nums text-expense">{money(item.value)}</span>
            <span className="block text-xs">{formatDate(item.date)}{sent ? ` · Apple Pay: ${sent}` : ""}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 pb-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Como você pagou</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Como você pagou">
              {METHODS.map(({ key, label, Icon }) => (
                <button
                  key={key} type="button" role="radio" aria-checked={choice.method === key} onClick={() => set({ method: key })}
                  data-testid={`pending-capture-method-${key}`}
                  className={cn("flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
                    choice.method === key ? "bg-background text-foreground shadow-sm ring-1 ring-primary/40" : "text-muted-foreground")}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </div>

          {credit ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-xs font-medium text-muted-foreground">Cartão
                <select className={cn(FIELD, "mt-1")} value={choice.cardId} onChange={(e) => set({ cardId: e.target.value })} data-testid="pending-capture-card">
                  <option value="">Escolher…</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="col-span-2 block text-xs font-medium text-muted-foreground">Parcelas
                <select className={cn(FIELD, "mt-1")} value={choice.installments} onChange={(e) => set({ installments: Number(e.target.value) })} data-testid="pending-capture-installments">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x de ${money(Math.round((item.value / n) * 100) / 100)}`}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <label className="block text-xs font-medium text-muted-foreground">Conta
              <select className={cn(FIELD, "mt-1")} value={choice.accountId} onChange={(e) => set({ accountId: e.target.value })} data-testid="pending-capture-account">
                <option value="">Escolher…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}

          {missing && sent ? (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300" data-testid="pending-capture-origin-unknown">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p>“{sent}” não está cadastrado como {credit ? "cartão de crédito" : "conta"}. Escolha acima ou cadastre.</p>
                <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={() => setDialog(credit ? "card" : "account")} data-testid={credit ? "pending-capture-create-card" : "pending-capture-create-account"}>
                  Cadastrar “{sent}” como {credit ? "cartão" : "conta ou vale"}
                </button>
              </div>
            </div>
          ) : null}

          {invoice ? (
            <p className="rounded-xl bg-primary/5 px-3 py-2.5 text-xs text-foreground" data-testid="pending-capture-invoice">
              <strong className="font-semibold">{invoiceLabel(invoice)}</strong>
              {invoice.afterClosing ? ". Comprou depois do fechamento, por isso entra na próxima fatura." : "."}
              {choice.installments > 1 ? ` As outras ${choice.installments - 1} parcelas vêm nas faturas seguintes.` : ""}
            </p>
          ) : null}

          <label className="block text-xs font-medium text-muted-foreground">Categoria
            <select className={cn(FIELD, "mt-1")} value={choice.categoryId} onChange={(e) => set({ categoryId: e.target.value })} data-testid="pending-capture-category">
              <option value="">Sem categoria</option>
              {lists.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {item.learned_category && choice.categoryId === item.suggested_category_id ? (
              <span className="mt-1 flex items-center gap-1 text-[11px] font-normal text-primary" data-testid="pending-capture-learned-category">
                <Sparkles className="h-3 w-3" aria-hidden="true" />Aprendida com suas compras neste comerciante
              </span>
            ) : null}
          </label>
        </div>

        <SheetFooter className="sticky bottom-0 flex-row items-center gap-2 border-t border-border bg-popover px-5 py-3">
          <Button type="button" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" onClick={onDiscard} disabled={registering} data-testid="pending-capture-discard">
            <Trash2 className="h-4 w-4" aria-hidden="true" />Excluir
          </Button>
          <Button type="button" className="h-11 min-w-0 flex-1" onClick={onRegister} disabled={!canRegister(choice) || registering} data-testid="pending-capture-register">
            {registering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            <span className="truncate">Registrar no {credit ? "crédito" : "débito"}{walletName ? ` · ${walletName}` : ""}</span>
          </Button>
        </SheetFooter>

        <CardDialog open={dialog === "card"} onOpenChange={closeDialog} initialName={sent} />
        <AccountDialog open={dialog === "account"} onOpenChange={closeDialog} initialName={sent} />
      </SheetContent>
    </Sheet>
  );
}

/** One purchase in one short card: what will be registered, and two buttons. */
function Row({ item, lists }: { item: PendingCapture; lists: Lists }) {
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const [choice, setChoice] = useState<CaptureChoice>(() => initialChoice(item));
  const set = (patch: Partial<CaptureChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
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
      toast.success(`${item.name} registrada no ${(as ?? choice.method) === "credito" ? "crédito" : "débito"}.`);
      await refresh();
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
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="pending-capture-edit">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{summary.missing ? "Completar" : "Alterar"}
              </Button>
              {!summary.missing ? (
                <Button type="button" size="sm" onClick={() => register.mutate(undefined)} disabled={register.isPending} data-testid="pending-capture-quick-register">
                  {register.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}Registrar
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}

      <EditSheet
        item={item} choice={choice} set={set} lists={lists} open={editing} onOpenChange={setEditing}
        onRegister={() => register.mutate(undefined)} registering={register.isPending} onDiscard={() => setDiscarding(true)}
      />
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
