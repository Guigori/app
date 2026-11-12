import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, fetchAccounts, updateAccount } from "@/lib/data";
import { MAX_WALLETS } from "@/lib/benefits";
import { BENEFIT_GRADIENTS } from "@/lib/benefitColors";
import { formatBRL, formatHiddenBRL, parseAmount, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { sectionTitle } from "@/lib/walletForms";
import { cn } from "@/lib/utils";
import { useOwnHeader } from "@/components/layout/BackButton";
import { Stepper, Switch } from "@/components/wallet/FormParts";
import { AdjustBalanceDialog } from "@/components/accounts/AdjustBalanceDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import type { BenefitWalletInput } from "@/types/finnos";

interface Draft { id?: string | null; name: string; monthlyRaw: string; day: number; is_default: boolean; allow_negative: boolean; initial_balance: number; balance: number; appRaw: string }
const wrap = (d: number) => ((d - 1 + 31) % 31) + 1;

/** Prototype "10 · Configurar benefício", for a card with one or up to 8 benefits. */
export default function WalletBenefitConfig() {
  const { accountId = "" } = useParams();
  useOwnHeader();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [runout, setRunout] = useState(false);
  const [recharge, setRecharge] = useState(false);
  const [adjusting, setAdjusting] = useState<{ walletId: string | null; target: number } | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!account || loaded) return;
    setName(account.name); setRunout(Boolean(account.benefit_runout_alert)); setRecharge(Boolean(account.benefit_recharge_alert));
    setDrafts(account.wallets?.length
      ? account.wallets.map((w) => ({ id: w.id, name: w.name, monthlyRaw: String(w.monthly_amount).replace(".", ","), day: w.day, is_default: w.is_default, allow_negative: w.allow_negative, initial_balance: w.initial_balance ?? 0, balance: w.balance, appRaw: "" }))
      : [{ id: null, name: account.name, monthlyRaw: "", day: 1, is_default: true, allow_negative: false, initial_balance: account.initial_balance, balance: account.balance, appRaw: "" }]);
    setLoaded(true);
  }, [account, loaded]);

  const set = (i: number, patch: Partial<Draft>) => setDrafts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : patch.is_default ? { ...d, is_default: false } : d)));
  const refresh = () => Promise.all(["accounts", "dashboard", "notifications"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const save = useMutation({
    mutationFn: async () => {
      if (!account) return;
      if (!name.trim()) throw new Error("Dê um nome ao cartão de benefício.");
      const wallets: BenefitWalletInput[] = drafts.map((d) => {
        const monthly = d.monthlyRaw.trim() ? parseAmount(d.monthlyRaw) : 0;
        if (!d.name.trim()) throw new Error("Dê um nome a cada benefício.");
        if (monthly === null || monthly < 0) throw new Error(`Informe a recarga mensal de ${d.name}.`);
        return { id: d.id ?? null, name: d.name.trim(), monthly_amount: monthly, day: d.day, is_default: d.is_default, allow_negative: d.allow_negative, initial_balance: d.initial_balance };
      });
      await updateAccount(account.id, {
        name: name.trim(), institution: account.institution, institution_id: account.institution_id ?? null, type: "beneficio", color: account.color,
        initial_balance: account.initial_balance, active: account.active, wallets, benefit_runout_alert: runout, benefit_recharge_alert: recharge,
      });
    },
    onSuccess: async () => { toast.success("Benefício atualizado."); await refresh(); navigate(-1); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: async () => account && updateAccount(account.id, { name: account.name, institution: account.institution, institution_id: account.institution_id ?? null, type: "beneficio", color: account.color, initial_balance: account.initial_balance, active: false }),
    onSuccess: async () => { toast.success("Benefício arquivado. O histórico fica nas análises."); await refresh(); navigate("/contas"); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: async () => account && deleteAccount(account.id),
    onSuccess: async () => { toast.success("Benefício excluído."); await refresh(); navigate("/contas"); },
    onError: (error) => { setConfirm(null); toast.error(getApiErrorMessage(error)); },
  });

  if (accountsQuery.isPending) return <FinnosPageLoading title="Carregando benefício" description="Buscando a configuração." />;
  if (!account) return <p className="py-10 text-center text-muted-foreground">Benefício não encontrado. <Link to="/contas" className="font-semibold text-primary">Voltar</Link></p>;
  const days = [...new Set(drafts.filter((d) => (parseAmount(d.monthlyRaw) ?? 0) > 0).map((d) => d.day))];
  const field = "h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none focus:border-primary";
  const row = "flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0";

  return (
    <div className="mx-auto w-full max-w-[560px] pb-10" data-testid="benefit-config">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></button>
        <h1 className="min-w-0 flex-1 font-heading text-xl font-bold">Configurar benefício</h1>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="h-10 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="benefit-config-save">Salvar</button>
      </header>

      <div className="mt-3.5 flex items-center gap-3.5 rounded-3xl p-4 text-white" style={{ background: BENEFIT_GRADIENTS[0] }}>
        <span className="h-9 w-[52px] shrink-0 rounded-lg bg-white/20" aria-hidden="true" />
        <span className="flex-1"><span className="block text-base font-bold">{name || "Benefício"}</span>
          <span className="block text-xs opacity-85">{account.institution ? `${account.institution} · ` : ""}{drafts.length > 1 ? `${drafts.length} benefícios` : "1 benefício"}{days.length === 1 ? ` · recarga todo dia ${days[0]}` : ""}</span></span>
      </div>

      <h2 className={sectionTitle}>Identificação</h2>
      <div className="rounded-3xl border border-border bg-card p-4">
        <label className="block"><span className="mb-2 block text-[13px] font-semibold">Nome do cartão</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={field} data-testid="benefit-config-name" /></label>
      </div>

      <h2 className={sectionTitle}>Saldo e recarga</h2>
      <div className="space-y-3">
        {drafts.map((d, i) => {
          const app = d.appRaw.trim() ? parseAmount(d.appRaw) : null;
          const diff = app === null ? 0 : Math.round((app - d.balance) * 100) / 100;
          return (
            <div key={d.id ?? `new-${i}`} className="flex flex-col gap-3.5 rounded-3xl border border-border bg-card p-4" data-testid={`benefit-config-wallet-${i}`}>
              <div className="flex items-end gap-2">
                <label className="block flex-1"><span className="mb-2 block text-[13px] font-semibold">Nome do benefício</span>
                  <input value={d.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={40} placeholder="Ex.: Refeição" className={field} data-testid={`benefit-config-wallet-name-${i}`} /></label>
                {drafts.length > 1 ? (
                  <button type="button" aria-label={`Remover ${d.name || "benefício"}`} className="grid size-12 place-items-center rounded-[14px] border border-border"
                    onClick={() => setDrafts((cur) => { const next = cur.filter((_, j) => j !== i); if (d.is_default && next.length) next[0] = { ...next[0], is_default: true }; return next; })}>
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
              {d.id ? (
                <>
                  <div className="flex justify-between text-sm"><span>Saldo no FINNOS</span><strong className="font-heading tabular-nums">{money(d.balance)}</strong></div>
                  <label className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3.5 py-3"><span className="text-sm">Saldo no app do benefício</span>
                    <input value={d.appRaw} onChange={(e) => set(i, { appRaw: e.target.value })} inputMode="decimal" aria-label={`Saldo no app do benefício ${d.name}`} placeholder="R$ 0,00"
                      className="h-10 w-[120px] rounded-xl border border-border bg-card px-2.5 text-right font-heading text-[15px] font-bold outline-none" /></label>
                  {diff !== 0 ? (
                    <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 dark:bg-amber-500/15">
                      <span className="flex-1 text-[13px] text-amber-900 dark:text-amber-200">Diferença de <strong className="tabular-nums">{diff > 0 ? "+ " : "− "}{money(Math.abs(diff))}</strong>.</span>
                      <button type="button" onClick={() => setAdjusting({ walletId: account.wallets?.length ? d.id ?? null : null, target: app! })} className="h-9 rounded-full bg-primary px-3.5 text-[13px] font-bold text-primary-foreground">Ajustar</button>
                    </div>
                  ) : null}
                </>
              ) : null}
              <label className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Recarga mensal</span>
                <input value={d.monthlyRaw} onChange={(e) => set(i, { monthlyRaw: e.target.value })} inputMode="decimal" placeholder="R$ 0,00"
                  className="h-11 w-[140px] rounded-[14px] border border-border bg-background px-3 text-right font-heading text-base font-bold outline-none" data-testid={`benefit-config-wallet-monthly-${i}`} /></label>
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">Cai no dia</span>
                <Stepper value={d.day} onMinus={() => set(i, { day: wrap(d.day - 1) })} onPlus={() => set(i, { day: wrap(d.day + 1) })} minusLabel="Recarga um dia antes" plusLabel="Recarga um dia depois" /></div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="benefit-default" checked={d.is_default} onChange={() => set(i, { is_default: true })} />Padrão no registro</label>
                <span className="flex items-center gap-2">Pode ficar negativo<Switch on={d.allow_negative} onChange={(on) => set(i, { allow_negative: on })} label={`${d.name} pode ficar negativo`} /></span>
              </div>
            </div>
          );
        })}
        {drafts.length < MAX_WALLETS ? (
          <button type="button" onClick={() => setDrafts((cur) => [...cur, { id: null, name: "", monthlyRaw: "", day: cur[0]?.day ?? 1, is_default: false, allow_negative: false, initial_balance: 0, balance: 0, appRaw: "" }])}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-border text-sm font-semibold text-primary" data-testid="benefit-config-add">
            <Plus className="size-4" aria-hidden="true" />Adicionar benefício ({drafts.length}/{MAX_WALLETS})
          </button>
        ) : null}
        <p className="mx-1 text-xs text-muted-foreground">A recarga entra sozinha todo mês. Se o valor mudar, ajuste aqui. O saldo que sobra acumula e não vence.</p>
      </div>

      <h2 className={sectionTitle}>Uso e avisos</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className={row}><span className="flex-1"><span className="block text-[15px] font-semibold">Avisar se for acabar antes da recarga</span><span className="block text-xs text-muted-foreground">Pelo ritmo de gasto do mês</span></span><Switch on={runout} onChange={setRunout} label="Avisar se for acabar antes da recarga" /></div>
        <div className={row}><span className="flex-1"><span className="block text-[15px] font-semibold">Avisar quando a recarga cair</span><span className="block text-xs text-muted-foreground">Notificação no dia da recarga</span></span><Switch on={recharge} onChange={setRecharge} label="Avisar quando a recarga cair" /></div>
      </div>

      <h2 className={sectionTitle}>Avançado</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <button type="button" onClick={() => setConfirm("archive")} className="block w-full border-b border-border/60 p-4 text-left text-[15px] font-semibold">
          Arquivar benefício<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Para quando trocar de emprego. O histórico fica nas análises.</span></button>
        <button type="button" onClick={() => setConfirm("delete")} className={cn("block w-full p-4 text-left text-[15px] font-semibold text-expense")}>
          Excluir benefício<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Pede confirmação antes de apagar.</span></button>
      </div>

      {adjusting ? (
        <AdjustBalanceDialog open onOpenChange={(open) => { if (!open) setAdjusting(null); }} account={account} suggested={adjusting.target} walletId={adjusting.walletId} date={todayISO()}
          onDone={() => { setAdjusting(null); setLoaded(false); void refresh(); }} />
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm === "delete" ? "Excluir benefício?" : "Arquivar benefício?"}
        description={confirm === "delete" ? `"${account.name}" será removido. Se tiver lançamentos, a exclusão é recusada e você pode arquivar.` : `"${account.name}" some da Carteira. O histórico continua nas análises.`}
        confirmLabel={confirm === "delete" ? "Excluir" : "Arquivar"} destructive={confirm === "delete"} loading={archive.isPending || remove.isPending}
        onConfirm={() => (confirm === "delete" ? remove.mutate() : archive.mutate())} />
    </div>
  );
}
