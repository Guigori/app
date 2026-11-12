import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { AlertCircle, Check, CloudOff, Eye, EyeOff, Lock, Moon, Plus, Sun } from "lucide-react";
import { toast } from "sonner";
import { getAccountPaymentMethods, clearLocalAccountPaymentMethods } from "@/lib/accountPaymentPreferences";
import { adjustAccountBalance, createAccount, deleteAccount, fetchAccounts, fetchCards, fetchInstitutions, fetchMe, fetchOpenReconciliations, linkLegacyInstitutions } from "@/lib/data";
import { investmentTotals, listInvestments } from "@/lib/investments";
import { listSyncOperations } from "@/lib/sync/queue";
import { isLocalMode } from "@/lib/mode";
import { useBalanceHidden } from "@/lib/balance";
import { formatBRL, formatHiddenBRL, todayISO } from "@/lib/format";
import { bankRows, upcomingInvoices, walletIndicators, walletWarnings } from "@/lib/walletSummary";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { WalletIndicators } from "@/components/wallet/WalletIndicators";
import { CardCarousel } from "@/components/wallet/CardCarousel";
import { BankList } from "@/components/wallet/BankList";
import { BenefitList } from "@/components/wallet/BenefitList";
import { UpcomingInvoices } from "@/components/wallet/UpcomingInvoices";
import { AddToWalletDialog, type AddKind } from "@/components/wallet/AddToWalletDialog";
import { SingleBank } from "@/components/wallet/SingleBank";
import { BankWizard, type BankChoice } from "@/components/wallet/BankWizard";
import { NewCardSheet } from "@/components/wallet/NewCardSheet";
import { BenefitWizard } from "@/components/wallet/BenefitWizard";
import { InstitutionManagerDialog } from "@/components/accounts/InstitutionManagerDialog";
import { AccountDetailDialog } from "@/components/accounts/AccountDetailDialog";
import { AdjustBalanceDialog } from "@/components/accounts/AdjustBalanceDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Account } from "@/types/finnos";

type Tab = "tudo" | "contas" | "cartoes" | "beneficios";
const TABS: { key: Tab; label: string }[] = [
  { key: "tudo", label: "Tudo" }, { key: "contas", label: "Contas" }, { key: "cartoes", label: "Cartões" }, { key: "beneficios", label: "Benefícios" },
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Nova Carteira (etapa 6, FINNOS_WALLET_V2), following the prototype "1 · Carteira". */
export default function Wallet() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.key === params.get("aba")) ? (params.get("aba") as Tab) : "tudo";
  const setTab = (next: Tab) => setParams((current) => {
    const copy = new URLSearchParams(current);
    if (next === "tudo") copy.delete("aba"); else copy.set("aba", next);
    return copy;
  }, { replace: true });
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const { hidden, toggle } = useBalanceHidden();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: async () => {
    try { return await fetchCards(); }
    catch (error) {
      if (!navigator.onLine && error instanceof Error && error.message === "FINNOS_OFFLINE_NO_CACHE") return [];
      throw error;
    }
  } });
  const institutionsQuery = useQuery({ queryKey: ["institutions"], queryFn: fetchInstitutions });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const investmentsQuery = useQuery({ queryKey: ["investments", me.data?.id], queryFn: () => listInvestments(me.data!.id), enabled: !!me.data, retry: false });
  // Only for the warning; a failure here must not hide the Carteira.
  const openRecQuery = useQuery({ queryKey: ["reconciliations", "open"], queryFn: fetchOpenReconciliations, retry: false, enabled: navigator.onLine || isLocalMode() });
  const pendingSync = useQuery({ queryKey: ["sync-operations", "count"], queryFn: async () => (isLocalMode() ? 0 : (await listSyncOperations()).length), refetchInterval: 15_000 });
  const accounts = accountsQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const institutions = institutionsQuery.data ?? [];
  const methodsQuery = useQuery({
    queryKey: ["payment-methods", accounts.map((a) => a.id).join(",")],
    queryFn: async () => Object.fromEntries(await Promise.all(accounts.filter((a) => a.type !== "beneficio").map(async (a) => [a.id, await getAccountPaymentMethods(a).catch(() => ["Pix", "Débito"])] as const))),
    enabled: accountsQuery.isSuccess,
  });
  const investments = (investmentsQuery.data ?? []).map((i) => ({ account: (i as { account?: string | null }).account ?? null, current: i.current ?? 0 }));
  const investedCents = Math.round(investmentTotals(investmentsQuery.data ?? []).current * 100);
  const today = todayISO();
  const indicators = walletIndicators(accounts, cards);
  const invoices = upcomingInvoices(cards, today);
  const warnings = walletWarnings(accounts, invoices, openRecQuery.data ?? [], cards);
  const recWarning = (openRecQuery.data ?? []).map((r) => ({ rec: r, account: accounts.find((a) => a.id === r.account_id) }))
    .find((x) => x.account && x.rec.difference);
  const otherWarnings = warnings.filter((w) => !recWarning || w.key !== `rec:${recWarning.rec.id}`);
  const banks = bankRows(accounts, cards, institutions);
  const benefitCount = accounts.filter((a) => a.type === "beneficio" && a.active).length;
  const cash = accounts.find((a) => a.type === "carteira" && a.active);
  // Prototype "15 · Com 1 banco": one bank, at most one card, nothing else yet.
  const single = tab === "tudo" && banks.length === 1 && !benefitCount && !cash && investedCents === 0 && cards.filter((c) => c.active).length <= 1 ? banks[0] : null;

  const [cardSheet, setCardSheet] = useState<{ open: boolean; preset?: BankChoice | null }>({ open: false });
  const [bankOpen, setBankOpen] = useState(false);
  const [benefitOpen, setBenefitOpen] = useState(false);
  const [addOpen, setAddOpenRaw] = useState(false);
  const [cashFirst, setCashFirst] = useState(false);
  const setAddOpen = (open: boolean, cash = false) => { setCashFirst(cash); setAddOpenRaw(open); };
  const [institutionManagerOpen, setInstitutionManagerOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ account: Account; suggested: number; reconciliationId: string } | null>(null);
  const [adjusted, setAdjusted] = useState<{ name: string; value: number } | null>(null);
  const add = (kind: Exclude<AddKind, "dinheiro">) => {
    if (kind === "cartao") setCardSheet({ open: true });
    else if (kind === "beneficio") setBenefitOpen(true);
    else setBankOpen(true);
  };
  const saveCash = async (value: number) => {
    if (cash) {
      if (Math.round(cash.balance * 100) !== Math.round(value * 100)) {
        await adjustAccountBalance(cash.id, { target_balance: value, reason: "Dinheiro em espécie informado na Carteira.", date: today });
      }
    } else {
      await createAccount({ name: "Dinheiro", institution: "", institution_id: null, type: "carteira", color: "#047857", initial_balance: value, active: true });
    }
    await Promise.all(["accounts", "dashboard", "transactions"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    toast.success("Dinheiro em espécie salvo.");
  };

  // Older accounts and cards only carry the bank name as text: link them to an institution once (idempotent).
  const linking = useRef(false);
  useEffect(() => {
    if (linking.current || !accountsQuery.isSuccess || !cardsQuery.isSuccess || !navigator.onLine) return;
    const unlinked = [...(accountsQuery.data ?? []).filter((a) => a.type !== "carteira"), ...(cardsQuery.data ?? [])].some((x) => !x.institution_id && (x.institution ?? "").trim().length >= 2);
    if (!unlinked) return;
    linking.current = true;
    void linkLegacyInstitutions().then((result) => {
      if (result.linked_accounts + result.linked_cards > 0) {
        void queryClient.invalidateQueries({ queryKey: ["accounts"] });
        void queryClient.invalidateQueries({ queryKey: ["cards"] });
        void queryClient.invalidateQueries({ queryKey: ["institutions"] });
      }
    }).catch(() => { /* tries again next visit */ });
  }, [accountsQuery.isSuccess, cardsQuery.isSuccess, accountsQuery.data, cardsQuery.data, queryClient]);

  const [selected, setSelected] = useState<Account | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: async (_r, deletedId) => {
      clearLocalAccountPaymentMethods(deletedId);
      toast.success("Conta excluída.");
      setPendingDelete(null); setSelected(null);
      await Promise.all(["accounts", "dashboard", "institutions"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        setPendingDelete(null);
        toast.info("Exclusão da conta aguardando sincronização", { description: "A conta continua no servidor até a confirmação. Não tente excluí-la novamente." });
        return;
      }
      toast.error(getApiErrorMessage(error));
    },
  });

  const loading = accountsQuery.isPending || cardsQuery.isPending || institutionsQuery.isPending;
  const failed = accountsQuery.isError || cardsQuery.isError || institutionsQuery.isError;
  const empty = accounts.length === 0 && cards.length === 0 && institutions.length === 0;
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const iconButton = "grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground";

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-5 animate-fade-up" data-testid="wallet-v2">
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[28px] font-bold tracking-[-0.03em]">Carteira</h1>
          {pendingSync.data ? (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600" data-testid="wallet-pending-sync">
              <CloudOff className="size-3.5" aria-hidden="true" />{plural(pendingSync.data, "registro aguardando sincronizar", "registros aguardando sincronizar")}
            </p>
          ) : !empty ? (
            <p data-keep="" className="text-[13px] text-muted-foreground" data-testid="wallet-counts">
              {[plural(banks.length, "banco", "bancos"), ...[[cards.filter((c) => c.active).length, "cartão", "cartões"], [benefitCount, "benefício", "benefícios"]].filter(([n]) => n).map(([n, one, many]) => plural(n as number, one as string, many as string))].join(" · ")}
            </p>
          ) : null}
        </div>
        {!empty ? <>
          <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"} className={iconButton}>
            {dark ? <Sun className="size-[19px]" /> : <Moon className="size-[19px]" />}
          </button>
          <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} aria-pressed={hidden} className={iconButton}>
            {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </> : null}
        <button type="button" onClick={() => setAddOpen(true)} aria-label="Adicionar à Carteira" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" data-testid="wallet-add">
          <Plus className="size-5" />
        </button>
      </header>

      {adjusted ? (
        <div className="flex items-center gap-2.5 rounded-[20px] bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" data-testid="wallet-adjusted">
          <Check className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="flex-1">Ajuste de <span className="tabular-nums">{money(adjusted.value)}</span> criado no {adjusted.name}. Saldos batem.</span>
          <button type="button" className="font-bold underline" onClick={() => setAdjusted(null)}>Ok</button>
        </div>
      ) : recWarning?.account ? (
        <div className="flex items-center gap-3 rounded-[20px] border border-amber-300 bg-card py-3 pl-3.5 pr-3" data-testid="wallet-warning-rec">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-amber-50 text-amber-700 dark:bg-amber-500/15"><AlertCircle className="size-[17px]" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug">
            <strong className="block">{recWarning.account.name}: diferença de <span className="tabular-nums">{money(Math.abs(recWarning.rec.difference!))}</span></strong>
            <span className="block text-muted-foreground">O banco mostra <span className="tabular-nums">{money(recWarning.account.balance + recWarning.rec.difference!)}</span></span>
          </span>
          <Link to={`/contas/${encodeURIComponent(recWarning.account.id)}/conferencia`} className="grid h-[38px] place-items-center rounded-full bg-primary/10 px-3 text-[13px] font-bold text-primary">Extrato</Link>
          <button type="button" className="h-[38px] rounded-full bg-primary px-3.5 text-[13px] font-bold text-primary-foreground" data-testid="wallet-warning-adjust"
            onClick={() => setAdjusting({ account: recWarning.account!, suggested: Math.round((recWarning.account!.balance + recWarning.rec.difference!) * 100) / 100, reconciliationId: recWarning.rec.id })}>Ajustar</button>
        </div>
      ) : null}
      {otherWarnings.length ? (
        <ul className="space-y-2" data-testid="wallet-warnings">
          {otherWarnings.slice(0, 3).map((w) => (
            <li key={w.key}>
              <Link to={w.to} className={cn("flex items-center gap-3 rounded-[20px] border bg-card px-3.5 py-3 text-[13px]", w.tone === "danger" ? "border-destructive/40" : "border-amber-300")}
                data-testid={`wallet-warning-${w.key.split(":")[0]}`}>
                <AlertCircle className={cn("size-[17px] shrink-0", w.tone === "danger" ? "text-destructive" : "text-amber-600")} aria-hidden="true" />
                <span className="min-w-0 flex-1"><strong className="block">{w.title}</strong><span className="block text-muted-foreground">{hidden ? "Toque para ver." : w.detail}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <FinnosPageLoading title="Carregando Carteira" description="Organizando suas contas, cartões e benefícios." />
      ) : failed ? (
        <Card role="alert" data-testid="accounts-load-error"><CardContent className="space-y-3 p-5">
          <p>{getApiErrorMessage(accountsQuery.error ?? cardsQuery.error ?? institutionsQuery.error, "Não foi possível carregar sua Carteira.")}</p>
          <Button variant="outline" onClick={() => { void accountsQuery.refetch(); void cardsQuery.refetch(); void institutionsQuery.refetch(); }}>Tentar novamente</Button>
        </CardContent></Card>
      ) : empty && tab === "tudo" ? (
        <FirstUse onPick={(kind) => (kind === "dinheiro" ? setAddOpen(true, true) : add(kind))} onManageInstitutions={() => setInstitutionManagerOpen(true)} />
      ) : single ? (
        <SingleBank bank={single} hidden={hidden} onAdd={add} />
      ) : (
        <>
          {tab === "tudo" ? <WalletIndicators ind={indicators} investedCents={investedCents} hidden={hidden} /> : null}
          <div className="grid grid-cols-4 gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="Mostrar">
            {TABS.map(({ key, label }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`wallet-tab-${key}`}
                className={cn("h-10 min-w-0 truncate rounded-full px-1 text-[13px] font-semibold", tab === key ? "bg-card text-primary shadow-[0_1px_4px_rgba(7,15,82,0.14)]" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
          {tab === "tudo" || tab === "cartoes" ? (
            cards.some((c) => c.active) ? <CardCarousel cards={cards} hidden={hidden} /> : tab === "cartoes" ? (
              <EmptyBlock title="Nenhum cartão de crédito" text="Cadastre um cartão para acompanhar a fatura, o limite e o melhor dia de compra." action="Adicionar cartão" onClick={() => add("cartao")} testId="cards-empty-create-button" />
            ) : null
          ) : null}
          {tab === "tudo" || tab === "contas" ? (
            <BankList accounts={accounts} cards={cards} institutions={institutions} investments={investments} methods={methodsQuery.data ?? {}}
              hidden={hidden} onOpenCash={setSelected} onManageInstitutions={() => setInstitutionManagerOpen(true)} />
          ) : null}
          {tab === "tudo" || tab === "beneficios" ? (
            benefitCount ? <BenefitList accounts={accounts} hidden={hidden} /> : tab === "beneficios" ? (
              <EmptyBlock title="Nenhum benefício cadastrado" text="VR, VA ou um cartão multi com até 8 benefícios, cada um com saldo e recarga." action="Adicionar benefício" onClick={() => add("beneficio")} testId="wallet-benefits-empty" />
            ) : null
          ) : null}
          {tab === "tudo" ? <UpcomingInvoices invoices={invoices} hidden={hidden} /> : tab === "cartoes" ? <UpcomingInvoices invoices={invoices} hidden={hidden} limit={12} /> : null}
        </>
      )}

      <AddToWalletDialog open={addOpen} onOpenChange={setAddOpen} onPick={add} onSaveCash={saveCash} cashNow={cash?.balance ?? null} startOnCash={cashFirst} />
      <BankWizard open={bankOpen} onOpenChange={setBankOpen} institutions={institutions} onCard={(bank) => setCardSheet({ open: true, preset: bank })} />
      <NewCardSheet open={cardSheet.open} onOpenChange={(open) => setCardSheet((prev) => ({ ...prev, open }))} institutions={institutions} preset={cardSheet.preset} />
      <BenefitWizard open={benefitOpen} onOpenChange={setBenefitOpen} />
      <InstitutionManagerDialog open={institutionManagerOpen} onOpenChange={setInstitutionManagerOpen} institutions={institutions} />
      {adjusting ? (
        <AdjustBalanceDialog open onOpenChange={(open) => { if (!open) setAdjusting(null); }} account={adjusting.account} suggested={adjusting.suggested}
          date={today} reconciliationId={adjusting.reconciliationId}
          onDone={(result) => { setAdjusted({ name: adjusting.account.name, value: Math.abs(result.difference) }); setAdjusting(null); void queryClient.invalidateQueries({ queryKey: ["reconciliations"] }); }} />
      ) : null}
      <AccountDetailDialog
        open={selected !== null}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        account={selected}
        cards={cards}
        onEdit={(account) => { setSelected(null); dialogs.openAccount(account); }}
        onDelete={(account) => setPendingDelete(account)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Excluir conta?"
        description={pendingDelete ? `A conta "${pendingDelete.name}" será removida. Contas com transações vinculadas não podem ser excluídas; nesse caso, desmarque "Conta ativa" para arquivar.` : ""}
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); }}
      />
    </div>
  );
}

function EmptyBlock({ title, text, action, onClick, testId }: { title: string; text: string; action: string; onClick: () => void; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-heading text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      <Button className="rounded-full" onClick={onClick} data-testid={testId}>{action}</Button>
    </div>
  );
}

/** Prototype "14 · Primeiro uso". */
function FirstUse({ onPick, onManageInstitutions }: { onPick: (kind: AddKind) => void; onManageInstitutions: () => void }) {
  return (
    <div data-testid="wallet-first-use">
      <div className="relative mx-auto h-[210px] max-w-[350px]" aria-hidden="true">
        <span className="absolute left-10 top-[30px] h-[136px] w-[220px] -rotate-[8deg] rounded-[20px] bg-gradient-to-br from-[#C9B5FF] to-[#8C5BFF] opacity-55" />
        <span className="absolute left-20 top-11 h-[136px] w-[220px] rotate-[4deg] rounded-[20px] bg-gradient-to-br from-[#8C5BFF] to-[#4B2CFF] shadow-[0_24px_40px_-22px_rgba(75,44,255,0.8)]" />
        <span className="absolute right-[26px] top-2.5 grid size-[54px] place-items-center rounded-[18px] border border-border bg-card text-primary"><Plus className="size-[26px]" /></span>
      </div>
      <div className="px-2 pt-2.5 text-center">
        <h2 className="font-heading text-2xl font-bold tracking-[-0.02em]">Comece pelo seu banco principal</h2>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">É onde cai o seu salário. Depois você junta cartões, benefícios e dinheiro para ver tudo num lugar só.</p>
      </div>
      <Button className="mt-6 h-14 w-full rounded-full text-[15px] font-bold" onClick={() => onPick("banco")} data-testid="accounts-empty-create-button">Adicionar meu banco</Button>
      <p className="mb-2.5 mt-4 text-center text-[13px] text-muted-foreground">ou comece por</p>
      <div className="grid grid-cols-3 gap-2">
        {([["cartao", "Cartão"], ["beneficio", "Benefício"], ["dinheiro", "Dinheiro"]] as const).map(([kind, label]) => (
          <Button key={kind} variant="outline" className="h-[46px] rounded-full text-[13px] font-bold" onClick={() => onPick(kind)} data-testid={`wallet-first-${kind}`}>{label}</Button>
        ))}
      </div>
      <div className="mt-6 flex items-start gap-2.5 rounded-[18px] bg-primary/[0.07] px-4 py-3.5">
        <Lock className="mt-px size-[18px] shrink-0 text-primary" aria-hidden="true" />
        <span className="text-[13px] leading-snug">O FINNOS não pede senha do banco. Você informa só o nome e o saldo.</span>
      </div>
      <button type="button" onClick={onManageInstitutions} className="mx-auto mt-4 block text-[13px] font-semibold text-primary">Instituições</button>
    </div>
  );
}
