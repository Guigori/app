import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createAccount, setDefaultAccount } from "@/lib/data";
import { setAccountPaymentMethods, type PaymentMethod } from "@/lib/accountPaymentPreferences";
import { INSTITUTION_CATALOG, institutionIdentity } from "@/lib/institutionCatalog";
import { bankInitials } from "@/lib/walletSummary";
import { formatBRL, parseAmount } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { Switch } from "@/components/wallet/FormParts";
import { cn } from "@/lib/utils";
import type { AccountType, Institution } from "@/types/finnos";

type Use = "conta" | "pix" | "debito" | "credito" | "invest";
const USES: { key: Use; label: string; hint: string; short: string }[] = [
  { key: "conta", label: "Conta", hint: "Tem saldo. Pix e débito saem dela.", short: "R$" },
  { key: "pix", label: "Pix", hint: "Sai do saldo da conta", short: "Px" },
  { key: "debito", label: "Débito", hint: "Sai do saldo da conta", short: "Db" },
  { key: "credito", label: "Cartão de crédito", hint: "Vai para a fatura", short: "Cr" },
  { key: "invest", label: "Investimentos", hint: "CDB, poupança, fundos", short: "Iv" },
];
const KINDS: { type: AccountType; label: string }[] = [{ type: "corrente", label: "Corrente" }, { type: "poupanca", label: "Poupança" }, { type: "digital", label: "Pagamento" }];
const STEPS = ["Escolha o banco", "Formas de pagamento", "Conta", "Revisão"];

export interface BankChoice { name: string; color: string; institutionId: string | null }

/** Prototype "11 · Cadastro de banco": 4 steps (bank, what is used, the account, review).
 * With "Cartão de crédito" marked it ends by opening the card registration for that bank. */
export function BankWizard({ open, onOpenChange, institutions, onCard }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutions: Institution[];
  /** Continue to the card registration with this bank chosen. */
  onCard: (bank: BankChoice) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [bank, setBank] = useState<BankChoice | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [uses, setUses] = useState<Record<Use, boolean>>({ conta: true, pix: true, debito: true, credito: false, invest: false });
  const [balanceRaw, setBalanceRaw] = useState("");
  const [kind, setKind] = useState<AccountType>("corrente");
  const [nick, setNick] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setStep(0); setQuery(""); setBank(null); setTyping(false); setTyped(""); setBalanceRaw(""); setKind("corrente"); setNick(""); setError(null);
    setUses({ conta: true, pix: true, debito: true, credito: false, invest: false }); setIsDefault(true);
  }, [open]);

  // The person's own banks first, then the catalog (no duplicates by name).
  const options = useMemo(() => {
    const own = institutions.filter((i) => i.kind !== "beneficio").map((i) => ({ name: i.name, color: i.color, institutionId: i.id as string | null }));
    const known = new Set(own.map((o) => o.name.toLocaleLowerCase("pt-BR")));
    const catalog = INSTITUTION_CATALOG.filter((c) => c.kind === "banco" && !known.has(c.name.toLocaleLowerCase("pt-BR"))).map((c) => ({ name: c.name, color: c.color, institutionId: null }));
    const q = query.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
    return [...own, ...catalog].filter((o) => !q || o.name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").includes(q));
  }, [institutions, query]);
  const chosen: BankChoice | null = typing ? (typed.trim() ? { name: typed.trim(), color: institutionIdentity(typed.trim()).color, institutionId: null } : null) : bank;
  const tint = (c: string) => `color-mix(in srgb, ${c} 12%, transparent)`;
  const balance = balanceRaw.trim() ? parseAmount(balanceRaw) : 0;

  const next = () => {
    setError(null);
    if (step === 0 && !chosen) return setError("Escolha o banco ou escreva o nome.");
    if (step === 1 && !uses.conta && !uses.credito) return setError("Marque a conta ou o cartão de crédito.");
    if (step === 2 && uses.conta && balance === null) return setError("Informe o saldo atual.");
    setStep((s) => Math.min(3, s + 1));
  };
  const save = async () => {
    if (!chosen) return;
    setSaving(true); setError(null);
    try {
      if (uses.conta) {
        const account = await createAccount({
          name: nick.trim() || "Conta", institution: chosen.name, institution_id: chosen.institutionId, type: kind, color: chosen.color,
          initial_balance: balance ?? 0, active: true, ...(isDefault ? { is_default: true } : {}),
        });
        const methods: PaymentMethod[] = [...(uses.pix ? ["Pix" as const] : []), ...(uses.debito ? ["Débito" as const] : []), "Boleto"];
        await setAccountPaymentMethods(account, methods).catch(() => undefined);
        if (isDefault && !account.is_default) await setDefaultAccount(account.id).catch(() => undefined);
      }
      await Promise.all(["accounts", "institutions", "dashboard", "payment-methods"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      onOpenChange(false);
      if (uses.credito) onCard(chosen);
      else toast.success(`${chosen.name} adicionado à Carteira.`);
    } catch (e) {
      if (e instanceof Error && e.message === "FINNOS_OFFLINE_QUEUED") { onOpenChange(false); toast.info("Banco aguardando sincronizar."); return; }
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  };

  const h2 = "font-heading text-2xl font-bold tracking-[-0.02em]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[560px] flex-col gap-0 overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[92dvh] sm:rounded-[30px] [&>button:last-child]:hidden" data-testid="account-form">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><X className="size-5" /></button>
          <div className="flex-1"><DialogTitle className="font-heading text-xl font-bold">Novo banco</DialogTitle>
            <p className="text-xs text-muted-foreground" data-testid="bank-wizard-step">Etapa {step + 1} de 4 · {STEPS[step]}</p></div>
        </div>
        <DialogDescription className="sr-only">Cadastro de banco em quatro etapas.</DialogDescription>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">{STEPS.map((s, i) => <span key={s} className={cn("h-[5px] rounded-full", i <= step ? "bg-primary" : "bg-primary/15")} />)}</div>

        {step === 0 ? (
          <div className="mt-6">
            <h2 className={h2}>Qual é o banco?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pode ser um banco onde você só tem cartão.</p>
            {!typing ? (
              <>
                <label className="mt-4 flex h-[50px] items-center gap-2.5 rounded-2xl border border-border bg-card px-4">
                  <Search className="size-[18px] text-muted-foreground" aria-hidden="true" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar banco" aria-label="Buscar banco" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" data-testid="bank-wizard-search" />
                </label>
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  {options.slice(0, 12).map((o) => {
                    const on = bank?.name === o.name;
                    return (
                      <button key={o.name} type="button" onClick={() => setBank(o)} aria-pressed={on} data-testid={`bank-wizard-option-${o.name}`}
                        className="flex flex-col items-center gap-2 rounded-[20px] px-1.5 py-3.5" style={{ background: on ? tint(o.color) : "var(--card)", border: on ? `2px solid ${o.color}` : "1px solid var(--border)" }}>
                        <span className="grid size-12 place-items-center rounded-2xl font-heading text-[15px] font-bold text-white" style={{ background: o.color }}>{bankInitials(o.name)}</span>
                        <span className="line-clamp-1 text-[13px] font-semibold">{o.name}</span>
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => { setTyping(true); setTyped(query); }} className="mt-3 h-[46px] w-full rounded-full border-[1.5px] border-dashed border-primary/40 text-sm font-semibold text-primary" data-testid="bank-wizard-other">Meu banco não está na lista</button>
              </>
            ) : (
              <div className="mt-4 rounded-[20px] border-2 border-dashed border-primary/40 bg-card p-3.5">
                <label className="block"><span className="mb-2 block text-[13px] font-semibold">Nome do banco</span>
                  <input id="wallet-institution-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder="Ex.: Banco do bairro" maxLength={60}
                    className="h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none" /></label>
                <button type="button" onClick={() => setTyping(false)} className="mt-2.5 text-[13px] font-semibold text-primary">Ver a lista de bancos</button>
              </div>
            )}
          </div>
        ) : null}

        {step === 1 && chosen ? (
          <div className="mt-6">
            <h2 className={h2}>O que você usa no {chosen.name}?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Marque tudo o que usa. Dá para mudar depois.</p>
            <div className="mt-4 flex flex-col gap-2.5">
              {USES.map((u) => {
                const on = uses[u.key];
                const disabled = (u.key === "pix" || u.key === "debito") && !uses.conta;
                return (
                  <button key={u.key} type="button" disabled={disabled} onClick={() => setUses((cur) => ({ ...cur, [u.key]: !cur[u.key], ...(u.key === "conta" && cur.conta ? { pix: false, debito: false } : {}) }))}
                    aria-pressed={on} data-testid={`bank-wizard-use-${u.key}`} className={cn("flex w-full items-center gap-3 rounded-[20px] px-3.5 py-3 text-left", disabled && "opacity-40")}
                    style={{ background: on ? tint(chosen.color) : "var(--card)", border: on ? `2px solid ${chosen.color}` : "1px solid var(--border)" }}>
                    <span className="grid size-10 place-items-center rounded-[13px] font-heading text-[13px] font-bold" style={on ? { background: chosen.color, color: "#fff" } : undefined}>{u.short}</span>
                    <span className="flex-1"><span className="block text-[15px] font-bold">{u.label}</span><span className="block text-xs text-muted-foreground">{u.hint}</span></span>
                    <span className="grid size-[26px] place-items-center rounded-full text-white" style={on ? { background: chosen.color } : { border: "2px solid var(--border)" }}>{on ? <Check className="size-4" /> : null}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 2 && chosen ? (
          <div className="mt-6">
            <h2 className={h2}>Sua conta no {chosen.name}</h2>
            {uses.conta ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Quanto tem nela agora? Pix e débito vão sair daqui.</p>
                <div className="mt-4 rounded-3xl border border-border bg-card p-4 text-center">
                  <label htmlFor="bank-wizard-balance" className="block text-[13px] text-muted-foreground">Saldo atual</label>
                  <input id="bank-wizard-balance" inputMode="decimal" value={balanceRaw} onChange={(e) => setBalanceRaw(e.target.value)} placeholder="R$ 0,00"
                    className="mt-1.5 w-full bg-transparent text-center font-heading text-[34px] font-bold outline-none" data-testid="account-initial-input" />
                  <p className="text-xs text-muted-foreground">No cheque especial? Use um valor negativo, como −500,00.</p>
                </div>
                <p className="mb-2 mt-4 text-[13px] font-semibold">Tipo de conta</p>
                <div className="grid grid-cols-3 gap-2">
                  {KINDS.map((k) => (
                    <button key={k.type} type="button" onClick={() => setKind(k.type)} aria-pressed={kind === k.type}
                      className={cn("h-11 rounded-full text-[13px] font-semibold", kind === k.type ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{k.label}</button>
                  ))}
                </div>
                <label htmlFor="bank-wizard-nick" className="mb-2 mt-4 block text-[13px] font-semibold">Apelido (opcional)</label>
                <input id="bank-wizard-nick" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Ex.: Conta salário" maxLength={60}
                  className="h-[50px] w-full rounded-2xl border border-border bg-card px-4 text-[15px] outline-none" data-testid="account-name-input" />
              </>
            ) : (
              <div className="mt-4 rounded-3xl border border-border bg-card p-4">
                <p className="text-[15px] font-bold">Sem conta neste banco</p>
                <p className="mt-1.5 text-sm text-muted-foreground">Tudo bem. O {chosen.name} vai aparecer na Carteira só com o cartão, e a fatura pode ser paga por uma conta de outro banco.</p>
              </div>
            )}
          </div>
        ) : null}

        {step === 3 && chosen ? (
          <div className="mt-6">
            <h2 className={h2}>Tudo certo?</h2>
            <p className="mt-1 text-sm text-muted-foreground">É assim que o {chosen.name} vai aparecer na Carteira.</p>
            <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
              <div className="flex items-center gap-3 p-4" style={{ background: tint(chosen.color) }} data-testid="bank-wizard-preview">
                <span className="grid size-12 place-items-center rounded-2xl font-heading font-bold text-white" style={{ background: chosen.color }}>{bankInitials(chosen.name)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-base font-bold">{nick.trim() ? `${chosen.name} · ${nick.trim()}` : chosen.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{USES.filter((u) => uses[u.key]).map((u) => u.label).join(" · ") || "Nada marcado"}</span></span>
                <strong className="text-[15px] tabular-nums">{uses.conta ? formatBRL(balance ?? 0) : "só cartão"}</strong>
              </div>
            </div>
            {uses.conta ? (
              <div className="mt-4 flex items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3.5">
                <span className="flex-1"><span className="block text-[15px] font-semibold">Conta padrão</span><span className="block text-xs text-muted-foreground">Vem marcada primeiro em Pix, débito e no pagamento de faturas</span></span>
                <Switch on={isDefault} onChange={setIsDefault} label="Conta padrão" />
              </div>
            ) : null}
            {uses.credito ? (
              <div className="mt-4 flex gap-3 rounded-[18px] bg-primary/[0.07] px-4 py-3.5">
                <CreditCard className="mt-px size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm">Você marcou cartão de crédito. Na próxima tela você cadastra o cartão.</span>
              </div>
            ) : null}
            {uses.invest ? <p className="mx-1 mt-3 text-xs text-muted-foreground">Os investimentos você cadastra em Patrimônio, ligados a esta conta.</p> : null}
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-4 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">{error}</p> : null}
        <div className="mt-auto flex gap-2.5 pt-5">
          {step > 0 ? <button type="button" onClick={() => setStep((s) => s - 1)} className="h-[54px] w-[110px] rounded-full border border-border bg-card text-[15px] font-bold">Voltar</button> : null}
          {step < 3 ? (
            <button type="button" onClick={next} className="h-[54px] flex-1 rounded-full bg-primary text-[15px] font-bold text-primary-foreground" data-testid="bank-wizard-next">Continuar</button>
          ) : (
            <button type="button" onClick={() => void save()} disabled={saving} className="h-[54px] flex-1 rounded-full bg-primary text-[15px] font-bold text-primary-foreground" data-testid="account-submit-button">
              {uses.credito ? (uses.conta ? "Salvar e cadastrar cartão" : "Cadastrar cartão") : "Salvar banco"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
