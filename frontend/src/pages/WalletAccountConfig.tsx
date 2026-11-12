import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, fetchAccounts, fetchCards, fetchTransactions, setDefaultAccount, updateAccount } from "@/lib/data";
import { getAccountPaymentMethods, setAccountPaymentMethods, type PaymentMethod } from "@/lib/accountPaymentPreferences";
import { bankInitials } from "@/lib/walletSummary";
import { formatBRL, formatDate, formatHiddenBRL, parseAmount, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useOwnHeader } from "@/components/layout/BackButton";
import { AdjustBalanceDialog } from "@/components/accounts/AdjustBalanceDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import type { AccountInput, AccountType } from "@/types/finnos";
import { Switch } from "@/components/wallet/FormParts";
import { sectionTitle } from "@/lib/walletForms";

const KINDS: { type: AccountType; label: string }[] = [{ type: "corrente", label: "Corrente" }, { type: "poupanca", label: "Poupança" }, { type: "digital", label: "Pagamento" }, { type: "salario", label: "Salário" }];

/** Prototype "3 · Configurar conta". */
export default function WalletAccountConfig() {
  const { accountId = "" } = useParams();
  useOwnHeader();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const countQuery = useQuery({ queryKey: ["transactions", { account_id: accountId, count: true }], queryFn: () => fetchTransactions({ account_id: accountId }), enabled: !!account });
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("corrente");
  const [overdraft, setOverdraft] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [lowOn, setLowOn] = useState(false);
  const [low, setLow] = useState(300);
  const [bankRaw, setBankRaw] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!account || loaded) return;
    setName(account.name); setType(account.type); setOverdraft(account.overdraft_limit ? String(account.overdraft_limit).replace(".", ",") : "");
    setIsDefault(Boolean(account.is_default)); setLowOn(Boolean(account.low_balance_alert)); setLow(account.low_balance_alert || 300);
    setLoaded(true);
    void getAccountPaymentMethods(account).then(setMethods).catch(() => setMethods(["Pix", "Débito"]));
  }, [account, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      if (!account) return;
      const limit = overdraft.trim() ? parseAmount(overdraft) : 0;
      if (limit === null || limit < 0) throw new Error("Informe um limite de cheque especial válido.");
      if (!name.trim()) throw new Error("Dê um apelido para a conta.");
      const input: AccountInput = {
        name: name.trim(), institution: account.institution, institution_id: account.institution_id ?? null, type, color: account.color,
        initial_balance: account.initial_balance, active: account.active, overdraft_limit: type === "poupanca" || type === "salario" ? 0 : limit,
        low_balance_alert: lowOn ? low : 0,
      };
      await updateAccount(account.id, input);
      await setAccountPaymentMethods({ ...account, type }, methods);
      if (isDefault && !account.is_default) await setDefaultAccount(account.id);
    },
    onSuccess: async () => {
      toast.success("Conta atualizada.");
      await Promise.all(["accounts", "payment-methods", "dashboard"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      navigate(-1);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: async () => account && updateAccount(account.id, { name: account.name, institution: account.institution, institution_id: account.institution_id ?? null, type: account.type, color: account.color, initial_balance: account.initial_balance, active: false }),
    onSuccess: async () => { toast.success("Conta arquivada. O histórico continua nas análises."); await queryClient.invalidateQueries({ queryKey: ["accounts"] }); navigate("/contas"); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: async () => account && deleteAccount(account.id),
    onSuccess: async () => { toast.success("Conta excluída."); await queryClient.invalidateQueries({ queryKey: ["accounts"] }); navigate("/contas"); },
    onError: (error) => { setConfirm(null); toast.error(getApiErrorMessage(error)); },
  });

  if (accountsQuery.isPending) return <FinnosPageLoading title="Carregando conta" description="Buscando a configuração." />;
  if (!account) return <p className="py-10 text-center text-muted-foreground">Conta não encontrada. <Link to="/contas" className="font-semibold text-primary">Voltar</Link></p>;
  const bank = bankRaw.trim() ? parseAmount(bankRaw) : null;
  const diff = bank === null ? 0 : Math.round((bank - account.balance) * 100) / 100;
  const cards = (cardsQuery.data ?? []).filter((c) => c.active && (account.institution_id ? c.institution_id === account.institution_id : c.institution === account.institution));
  const hasOverdraft = type === "corrente" || type === "digital";
  const toggleMethod = (m: PaymentMethod, on: boolean) => setMethods((cur) => (on ? [...new Set([...cur, m])] : cur.filter((x) => x !== m)));
  const field = "h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none focus:border-primary";
  const row = "flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0";

  return (
    <div className="mx-auto w-full max-w-[560px] pb-10" data-testid="account-config">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></button>
        <h1 className="min-w-0 flex-1 font-heading text-xl font-bold">Configurar conta</h1>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="h-10 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="account-config-save">Salvar</button>
      </header>

      <div className="mt-3.5 flex items-center gap-3.5 rounded-3xl p-4" style={{ background: `color-mix(in srgb, ${account.color} 12%, transparent)` }}>
        <span className="grid size-14 shrink-0 place-items-center rounded-[18px] font-heading text-lg font-bold text-white" style={{ background: account.color }}>{bankInitials(account.institution || account.name)}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-bold">{account.institution ? `${account.institution} · ` : ""}{name || "Conta"}</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">Conta {KINDS.find((k) => k.type === type)?.label.toLowerCase() ?? ""} · {["Pix", "Débito"].filter((m) => methods.includes(m as PaymentMethod)).join(" e ") || "só saldo"}{methods.some((m) => m === "Pix" || m === "Débito") ? " ativos" : ""}</span></span>
      </div>

      <h2 className={sectionTitle}>Identificação</h2>
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4">
        <label className="block"><span className="mb-2 block text-[13px] font-semibold">Apelido</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Conta salário" maxLength={60} className={field} data-testid="account-config-name" /></label>
        <div>
          <p className="mb-2 text-[13px] font-semibold">Tipo de conta</p>
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map((k) => (
              <button key={k.type} type="button" onClick={() => setType(k.type)} aria-pressed={type === k.type}
                className={cn("h-[42px] rounded-full text-[13px] font-semibold", type === k.type ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{k.label}</button>
            ))}
          </div>
        </div>
        {hasOverdraft ? (
          <label className="block"><span className="mb-2 block text-[13px] font-semibold">Limite do cheque especial</span>
            <input value={overdraft} onChange={(e) => setOverdraft(e.target.value)} inputMode="decimal" placeholder="0,00 (sem cheque especial)" className={field} data-testid="account-config-overdraft" />
            <span className="mt-1.5 block text-xs text-muted-foreground">Com limite, um pagamento maior que o saldo pede a sua confirmação antes de usar.</span></label>
        ) : null}
      </div>

      <h2 className={sectionTitle}>Saldo</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex items-center gap-3 p-4">
          <span className="flex-1"><span className="block text-[15px] font-semibold">Saldo no FINNOS</span><span className="block text-xs text-muted-foreground">Calculado pelos lançamentos</span></span>
          <strong className="font-heading text-lg tabular-nums">{money(account.balance)}</strong>
        </div>
        <div className="px-4 pb-4">
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3.5 py-3"><span className="text-sm">Saldo no app do banco</span>
            <input value={bankRaw} onChange={(e) => setBankRaw(e.target.value)} inputMode="decimal" aria-label="Saldo no app do banco" placeholder="R$ 0,00"
              className="h-10 w-[130px] rounded-xl border border-border bg-card px-2.5 text-right font-heading text-[15px] font-bold outline-none" data-testid="account-config-bank-balance" /></label>
          {diff !== 0 ? (
            <>
              <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 dark:bg-amber-500/15" data-testid="account-config-diff">
                <AlertTriangle className="mt-px size-[18px] shrink-0 text-amber-700" aria-hidden="true" />
                <span className="text-[13px] text-amber-900 dark:text-amber-200">Diferença de <strong className="tabular-nums">{diff > 0 ? "+ " : "− "}{money(Math.abs(diff))}</strong>. Pode ser um lançamento que faltou registrar.</span>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <Link to={`/contas/${encodeURIComponent(account.id)}/conferencia`} className="grid h-11 place-items-center rounded-full border border-border bg-card text-[13px] font-bold">Conferir com extrato</Link>
                <button type="button" onClick={() => setAdjusting(true)} className="h-11 rounded-full bg-primary/10 text-[13px] font-bold text-primary" data-testid="account-config-adjust">Criar ajuste</button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {account.type !== "beneficio" ? (
        <>
          <h2 className={sectionTitle}>Formas de pagamento desta conta</h2>
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            {([["Pix", "Pix enviados saem deste saldo"], ["Débito", "Compras no débito saem deste saldo"], ["Boleto", "Boletos pagos saem deste saldo"]] as const).map(([m, hint]) => (
              <div key={m} className={row}>
                <span className="flex-1"><span className="block text-[15px] font-semibold">{m}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                <Switch on={methods.includes(m)} onChange={(on) => toggleMethod(m, on)} label={m} />
              </div>
            ))}
            {cards.map((c) => (
              <Link key={c.id} to={`/cartoes/${encodeURIComponent(c.id)}/configurar`} className={row}>
                <span className="flex-1"><span className="block text-[15px] font-semibold">Cartão de crédito {c.name}</span><span className="block text-xs text-muted-foreground">{c.last_digits ? `•••• ${c.last_digits} · ` : ""}configurar no cartão</span></span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <h2 className={sectionTitle}>Na Carteira e nos avisos</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className={row}>
          <span className="flex-1"><span className="block text-[15px] font-semibold">Conta padrão</span><span className="block text-xs text-muted-foreground">Vem marcada primeiro em Pix, débito e no pagamento de faturas</span></span>
          <Switch on={isDefault} onChange={setIsDefault} label="Conta padrão" />
        </div>
        <div className={row}>
          <span className="flex-1"><span className="block text-[15px] font-semibold">Avisar saldo baixo</span><span className="block text-xs text-muted-foreground">Notificação quando o saldo cair</span></span>
          <Switch on={lowOn} onChange={setLowOn} label="Avisar saldo baixo" />
        </div>
        {lowOn ? (
          <div className="flex items-center justify-between gap-3 bg-background px-4 py-3.5" data-testid="account-config-low">
            <span className="text-sm">Avisar quando ficar abaixo de</span>
            <span className="flex items-center gap-2.5">
              <button type="button" onClick={() => setLow((v) => Math.max(50, v - 50))} aria-label="Diminuir" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
              <strong className="min-w-[72px] text-center font-heading text-[15px] tabular-nums">R$ {low}</strong>
              <button type="button" onClick={() => setLow((v) => v + 50)} aria-label="Aumentar" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
            </span>
          </div>
        ) : null}
      </div>

      <h2 className={sectionTitle}>Avançado</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex justify-between border-b border-border/60 px-4 py-3.5 text-sm"><span className="text-muted-foreground">Saldo inicial</span><strong className="tabular-nums">{money(account.initial_balance)}{account.created_at ? ` em ${formatDate(account.created_at.slice(0, 10))}` : ""}</strong></div>
        <div className="flex justify-between border-b border-border/60 px-4 py-3.5 text-sm"><span className="text-muted-foreground">Lançamentos</span><strong>{countQuery.data ? countQuery.data.length : "—"}</strong></div>
        <button type="button" onClick={() => setConfirm("archive")} className="block w-full border-b border-border/60 p-4 text-left text-[15px] font-semibold" data-testid="account-config-archive">
          Arquivar conta<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Some da Carteira, mas o histórico fica nas análises.</span></button>
        <button type="button" onClick={() => setConfirm("delete")} className="block w-full p-4 text-left text-[15px] font-semibold text-expense" data-testid="account-config-delete">
          Excluir conta<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Pede confirmação. Conta com lançamentos não pode ser excluída: arquive.</span></button>
      </div>

      {adjusting && bank !== null ? (
        <AdjustBalanceDialog open onOpenChange={(open) => { if (!open) setAdjusting(false); }} account={account} suggested={bank} date={todayISO()}
          onDone={() => { setAdjusting(false); setBankRaw(""); void queryClient.invalidateQueries({ queryKey: ["accounts"] }); }} />
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm === "delete" ? "Excluir conta?" : "Arquivar conta?"}
        description={confirm === "delete" ? `"${account.name}" será removida. Se tiver lançamentos, a exclusão é recusada e você pode arquivar.` : `"${account.name}" some da Carteira. Os lançamentos continuam nas análises e dá para reativar depois.`}
        confirmLabel={confirm === "delete" ? "Excluir" : "Arquivar"} destructive={confirm === "delete"} loading={archive.isPending || remove.isPending}
        onConfirm={() => (confirm === "delete" ? remove.mutate() : archive.mutate())} />
    </div>
  );
}
