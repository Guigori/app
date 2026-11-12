import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createAccount } from "@/lib/data";
import { INSTITUTION_CATALOG, institutionIdentity } from "@/lib/institutionCatalog";
import { MAX_WALLETS } from "@/lib/benefits";
import { formatBRL, parseAmount } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { Switch } from "@/components/wallet/FormParts";
import { cn } from "@/lib/utils";
import type { BenefitWalletInput } from "@/types/finnos";

type Purpose = "refeicao" | "alimentacao" | "multi";
const PURPOSES: { key: Purpose; label: string; card: string; wallet: string }[] = [
  { key: "refeicao", label: "Refeição", card: "Vale-refeição", wallet: "Refeição" },
  { key: "alimentacao", label: "Alimentação", card: "Vale-alimentação", wallet: "Alimentação" },
  { key: "multi", label: "Multi", card: "Multibenefício", wallet: "" },
];
const WALLET_COLORS = ["#00A86B", "#F59E0B", "#0EA5E9", "#EC4899", "#8C5BFF", "#14B8A6", "#E11D48", "#4B2CFF"];
const wrap = (d: number) => ((d - 1 + 31) % 31) + 1;
interface Row { name: string; monthly: string; initial: string; day: number }

/** Prototype "13 · Cadastro de benefício": simple (one balance) or multi (up to 8 benefits,
 * each with its value and day). One default benefit for everything (decision). */
export function BenefitWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const providers = INSTITUTION_CATALOG.filter((c) => c.kind === "beneficio");
  const [issuer, setIssuer] = useState<string>(providers[0]?.name ?? "");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("refeicao");
  const [balance, setBalance] = useState("");
  const [monthly, setMonthly] = useState("");
  const [day, setDay] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setIssuer(providers[0]?.name ?? ""); setTyping(false); setTyped(""); setPurpose("refeicao"); setBalance(""); setMonthly(""); setDay(5);
    setRows([{ name: "Refeição", monthly: "", initial: "", day: 5 }, { name: "Alimentação", monthly: "", initial: "", day: 5 }]); setIsDefault(true); setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const issuerName = typing ? typed.trim() : issuer;
  const color = providers.find((p) => p.name === issuerName)?.color ?? institutionIdentity(issuerName || "Benefício").color;
  const multi = purpose === "multi";
  const num = (raw: string) => (raw.trim() ? parseAmount(raw) : 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (num(r.monthly) ?? 0), 0);

  const save = async () => {
    setError(null);
    if (!issuerName) return setError("Escolha a empresa do benefício ou escreva o nome.");
    const def = PURPOSES.find((p) => p.key === purpose)!;
    let wallets: BenefitWalletInput[];
    if (multi) {
      if (!rows.length) return setError("Adicione pelo menos um benefício.");
      wallets = [];
      for (const [i, r] of rows.entries()) {
        const m = num(r.monthly), init = num(r.initial);
        if (!r.name.trim()) return setError(`Dê um nome ao benefício ${i + 1}.`);
        if (m === null || m < 0 || init === null) return setError(`Confira os valores de ${r.name}.`);
        wallets.push({ name: r.name.trim(), monthly_amount: m, day: r.day, initial_balance: init, allow_negative: false, is_default: i === 0 });
      }
    } else {
      const m = num(monthly), init = num(balance);
      if (m === null || m < 0 || init === null) return setError("Confira o saldo e a recarga.");
      wallets = [{ name: def.wallet, monthly_amount: m, day, initial_balance: init, allow_negative: false, is_default: true }];
    }
    setSaving(true);
    try {
      await createAccount({
        name: multi ? issuerName : def.card, institution: issuerName, institution_id: null, type: "beneficio", color,
        initial_balance: wallets.reduce((s, w) => s + w.initial_balance, 0), active: true, wallets, ...(isDefault ? { is_default: true } : {}),
      });
      await Promise.all(["accounts", "institutions", "dashboard"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      toast.success("Benefício cadastrado.");
      onOpenChange(false);
    } catch (e) {
      if (e instanceof Error && e.message === "FINNOS_OFFLINE_QUEUED") { onOpenChange(false); toast.info("Benefício aguardando sincronizar."); return; }
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  };

  const money = "h-11 w-[150px] rounded-[14px] border border-border bg-background px-3 text-right font-heading text-base font-bold outline-none";
  const small = "h-10 w-full rounded-xl border border-border bg-background px-2.5 text-right font-heading text-sm font-bold outline-none";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[560px] flex-col gap-0 overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[92dvh] sm:rounded-[30px] [&>button:last-child]:hidden" data-testid="benefit-form">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><X className="size-5" /></button>
          <DialogTitle className="flex-1 font-heading text-xl font-bold">Novo benefício</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Cadastro de benefício simples ou multi.</DialogDescription>

        <div className="mt-3.5 flex h-[190px] shrink-0 flex-col justify-between rounded-3xl p-5 text-white transition-[background] duration-300" style={{ background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 55%, #070F52) 100%)`, boxShadow: `0 22px 44px -22px ${color}` }} data-testid="benefit-preview">
          <span className="flex justify-between text-[13px] opacity-90"><span className="font-heading text-lg font-bold opacity-100">{issuerName || "Benefício"}</span><span>{PURPOSES.find((p) => p.key === purpose)!.card}</span></span>
          <span>
            <span className="block text-xs opacity-85">{multi ? "Total por mês" : "Saldo"}</span>
            <span className="block font-heading text-[30px] font-bold tabular-nums">{formatBRL(multi ? total : num(balance) ?? 0)}</span>
            {multi ? (
              <span className="mt-2 flex gap-1.5 overflow-hidden">
                {rows.map((r, i) => (
                  <span key={i} className="min-w-[74px] shrink-0 rounded-[10px] border border-white/25 bg-white/20 px-2 py-1.5">
                    <span className="block text-[10px] opacity-85">{r.name || "Sem nome"}</span><span className="block text-xs font-bold tabular-nums">{formatBRL(num(r.monthly) ?? 0).replace(/,00$/, "")}</span><span className="block text-[9px] opacity-80">dia {r.day}</span>
                  </span>
                ))}
              </span>
            ) : <span className="mt-1 block text-xs opacity-85">Recarga de {formatBRL(num(monthly) ?? 0)} todo dia {day}</span>}
          </span>
        </div>

        <h3 className="mx-1 mb-2.5 mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Empresa do benefício</h3>
        {!typing ? (
          <div className="grid grid-cols-3 gap-2">
            {providers.map((p) => (
              <button key={p.id} type="button" onClick={() => setIssuer(p.name)} aria-pressed={issuer === p.name} data-testid={`benefit-wizard-issuer-${p.name}`}
                className={cn("inline-flex h-[46px] items-center justify-center gap-2 rounded-2xl text-sm font-semibold", issuer === p.name ? "border-2 border-primary bg-primary/[0.07]" : "border border-border bg-card")}>
                <span className="size-2.5 rounded-full" style={{ background: p.color }} />{p.name}
              </button>
            ))}
            <button type="button" onClick={() => setTyping(true)} className="col-span-3 h-[46px] rounded-2xl border border-dashed border-border text-sm font-semibold text-primary" data-testid="benefit-wizard-other">Outra empresa</button>
          </div>
        ) : (
          <div className="rounded-[20px] border-2 border-dashed border-primary/40 bg-card p-3.5">
            <label className="block"><span className="mb-2 block text-[13px] font-semibold">Nome da empresa</span>
              <input id="wallet-institution-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus maxLength={60} placeholder="Ex.: Swile" className="h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none" /></label>
            <button type="button" onClick={() => setTyping(false)} className="mt-2.5 text-[13px] font-semibold text-primary">Ver a lista</button>
          </div>
        )}

        <p className="mx-1 mb-2 mt-4 text-[13px] font-semibold">Para que é?</p>
        <div className="grid grid-cols-3 gap-2">
          {PURPOSES.map((p) => (
            <button key={p.key} type="button" onClick={() => setPurpose(p.key)} aria-pressed={purpose === p.key} data-testid={`benefit-wizard-purpose-${p.key}`}
              className={cn("h-11 rounded-full text-[13px] font-semibold", purpose === p.key ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{p.label}</button>
          ))}
        </div>

        {multi ? (
          <>
            <div className="mx-1 mb-1 mt-5 flex items-baseline justify-between"><h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Benefícios dentro do cartão</h3><span className="text-xs text-muted-foreground">{rows.length} de {MAX_WALLETS}</span></div>
            <p className="mx-1 mb-2.5 text-[13px] text-muted-foreground">Cada um funciona como um cartão próprio: tem nome, valor e dia em que cai.</p>
            <div className="flex flex-col gap-2.5">
              {rows.map((r, i) => (
                <div key={i} className="rounded-[20px] border border-border bg-card p-3" style={{ borderLeft: `4px solid ${WALLET_COLORS[i % 8]}` }} data-testid={`benefit-wallet-${i}`}>
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-white" style={{ background: WALLET_COLORS[i % 8] }}>{i + 1}</span>
                    <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Nome, ex.: Refeição" aria-label={`Nome do benefício ${i + 1}`} maxLength={40}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] font-semibold outline-none" data-testid={`wallet-name-${i}`} />
                    <button type="button" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remover ${r.name || "benefício"}`} className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground">×</button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-2">
                    <label className="block"><span className="mb-1 block text-[11px] text-muted-foreground">Valor por mês</span><input value={r.monthly} onChange={(e) => setRow(i, { monthly: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label={`Valor de ${r.name}`} className={small} data-testid={`wallet-monthly-${i}`} /></label>
                    <label className="block"><span className="mb-1 block text-[11px] text-muted-foreground">Saldo agora</span><input value={r.initial} onChange={(e) => setRow(i, { initial: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label={`Saldo de ${r.name}`} className={small} data-testid={`wallet-initial-${i}`} /></label>
                    <span className="block"><span className="mb-1 block text-[11px] text-muted-foreground">Cai no dia</span>
                      <span className="flex h-10 items-center justify-between rounded-xl border border-border bg-background px-1">
                        <button type="button" onClick={() => setRow(i, { day: wrap(r.day - 1) })} aria-label="Dia antes" className="grid size-8 place-items-center rounded-full bg-card">−</button>
                        <strong className="font-heading text-[15px]">{r.day}</strong>
                        <button type="button" onClick={() => setRow(i, { day: wrap(r.day + 1) })} aria-label="Dia depois" className="grid size-8 place-items-center rounded-full bg-card">+</button>
                      </span></span>
                  </div>
                </div>
              ))}
              {rows.length < MAX_WALLETS ? (
                <button type="button" onClick={() => setRows((cur) => [...cur, { name: "", monthly: "", initial: "", day: cur[0]?.day ?? 5 }])} className="h-[50px] rounded-[18px] border-2 border-dashed border-primary/40 text-sm font-bold text-primary" data-testid="benefit-wallet-add">+ Adicionar benefício</button>
              ) : <p className="rounded-[14px] bg-primary/[0.07] p-3 text-center text-[13px]">Limite de {MAX_WALLETS} benefícios por cartão.</p>}
            </div>
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-3.5 rounded-3xl border border-border bg-card p-4">
            <label className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Saldo agora</span><input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={money} data-testid="wallet-initial-0" /></label>
            <label className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Recarga mensal</span><input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={money} data-testid="wallet-monthly-0" /></label>
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Cai no dia</span>
              <span className="flex items-center gap-3.5">
                <button type="button" onClick={() => setDay(wrap(day - 1))} aria-label="Recarga um dia antes" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
                <strong className="font-heading text-xl">{day}</strong>
                <button type="button" onClick={() => setDay(wrap(day + 1))} aria-label="Recarga um dia depois" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
              </span></div>
          </div>
        )}

        <div className="mt-3.5 flex items-center gap-3 rounded-3xl border border-border bg-card px-4 py-3.5">
          <span className="flex-1"><span className="block text-[15px] font-semibold">Benefício padrão</span><span className="block text-xs text-muted-foreground">Vem marcado primeiro no registro, para qualquer gasto. Dá para trocar na hora.</span></span>
          <Switch on={isDefault} onChange={setIsDefault} label="Benefício padrão" />
        </div>
        <p className="mx-1 mt-3 text-xs text-muted-foreground">Benefício não tem fatura: cada gasto sai do saldo dele e não mistura com o saldo do banco. O que sobra acumula e não vence.</p>
        {error ? <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">{error}</p> : null}
        <div className="mt-auto pt-5">
          <button type="button" onClick={() => void save()} disabled={saving} className="h-[54px] w-full rounded-full bg-primary text-[15px] font-bold text-primary-foreground" data-testid="account-submit-button">Salvar benefício</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
