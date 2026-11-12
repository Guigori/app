import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createCard, setDefaultCard } from "@/lib/data";
import { institutionIdentity } from "@/lib/institutionCatalog";
import { cardGradient } from "@/lib/cardGradient";
import { formatBRL, parseAmount } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/errors";
import { Switch } from "@/components/wallet/FormParts";
import { cn } from "@/lib/utils";
import type { CardNetwork, Institution } from "@/types/finnos";
import type { BankChoice } from "@/components/wallet/BankWizard";

const NETWORKS: { key: CardNetwork; label: string }[] = [{ key: "visa", label: "Visa" }, { key: "master", label: "Master" }, { key: "elo", label: "Elo" }, { key: "amex", label: "Amex" }];
const wrap = (d: number) => ((d - 1 + 31) % 31) + 1;

/** Prototype "12 · Cadastro de cartão": live preview, the bank as chips (+ Banco novo), dates with
 * the best purchase day, default switch. The paying account is chosen when paying. */
export function NewCardSheet({ open, onOpenChange, institutions, preset }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutions: Institution[];
  /** Bank chosen in the bank registration. */
  preset?: BankChoice | null;
}) {
  const queryClient = useQueryClient();
  const banks = useMemo(() => institutions.filter((i) => i.kind !== "beneficio").map((i) => ({ name: i.name, color: i.color, institutionId: i.id as string | null })), [institutions]);
  const [bank, setBank] = useState<BankChoice | "new" | null>(null);
  const [newBank, setNewBank] = useState("");
  const [name, setName] = useState("");
  const [last, setLast] = useState("");
  const [network, setNetwork] = useState<CardNetwork | "">("");
  const [limitRaw, setLimitRaw] = useState("");
  const [close, setClose] = useState(3);
  const [due, setDue] = useState(10);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const found = preset ? banks.find((b) => b.name.toLocaleLowerCase("pt-BR") === preset.name.toLocaleLowerCase("pt-BR")) ?? preset : null;
    setBank(found ?? (banks[0] ?? "new")); setNewBank(""); setName(""); setLast(""); setNetwork(""); setLimitRaw(""); setClose(3); setDue(10); setIsDefault(false); setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const issuer: BankChoice | null = bank === "new" ? (newBank.trim() ? { name: newBank.trim(), color: institutionIdentity(newBank.trim()).color, institutionId: null } : null) : bank;
  const color = issuer?.color ?? "#4B2CFF";
  const limit = parseAmount(limitRaw || "0") ?? 0;
  const term = (31 - close) + due;
  const chips = bank && bank !== "new" && !banks.some((b) => b.name === bank.name) ? [bank, ...banks] : banks;

  const save = async () => {
    setError(null);
    if (!issuer) return setError("Escolha o banco do cartão ou escreva o nome do banco novo.");
    if (!name.trim()) return setError("Dê um nome ao cartão.");
    if (!(limit > 0)) return setError("Informe o limite.");
    if (last && !/^\d{4}$/.test(last)) return setError("O final do cartão tem 4 números.");
    setSaving(true);
    try {
      const card = await createCard({
        name: name.trim(), institution: issuer.name, institution_id: issuer.institutionId, color: issuer.color, limit, closing_day: close, due_day: due,
        payment_account_id: null, active: true, last_digits: last, network, ...(isDefault ? { is_default: true } : {}),
      });
      if (isDefault && !card.is_default) await setDefaultCard(card.id).catch(() => undefined);
      await Promise.all(["cards", "institutions", "dashboard"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      toast.success("Cartão cadastrado.");
      onOpenChange(false);
    } catch (e) {
      if (e instanceof Error && e.message === "FINNOS_OFFLINE_QUEUED") { onOpenChange(false); toast.info("Cartão aguardando sincronizar."); return; }
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  };

  const field = "h-[50px] w-full rounded-2xl border border-border bg-card px-3.5 text-[15px] outline-none focus:border-primary";
  const stepper = (label: string, value: number, setValue: (v: number) => void, aria: string) => (
    <div className="rounded-[18px] bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <button type="button" onClick={() => setValue(wrap(value - 1))} aria-label={`${aria} um dia antes`} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
        <strong className="font-heading text-[22px]">{value}</strong>
        <button type="button" onClick={() => setValue(wrap(value + 1))} aria-label={`${aria} um dia depois`} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[560px] flex-col gap-0 overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[92dvh] sm:rounded-[30px] [&>button:last-child]:hidden" data-testid="card-form">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><X className="size-5" /></button>
          <DialogTitle className="flex-1 font-heading text-xl font-bold">Novo cartão de crédito</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Cadastro de cartão de crédito com prévia ao vivo.</DialogDescription>

        <div className="mt-3.5 flex h-[212px] shrink-0 flex-col justify-between rounded-3xl p-5 text-white transition-[background] duration-300" style={{ background: cardGradient(color), boxShadow: `0 22px 44px -22px ${color}` }} data-testid="card-preview">
          <span><span className="block font-heading text-[22px] font-bold">{name.trim() || "Sem nome"}</span><span className="block text-xs opacity-85">{issuer?.name ?? "Banco"} · crédito</span></span>
          <span className="flex items-end justify-between">
            <span><span className="block text-[11px] opacity-80">Limite</span><span className="block font-heading text-xl font-bold tabular-nums">{formatBRL(limit)}</span></span>
            <span className="text-sm opacity-90">•••• {(last || "").padEnd(4, "•")}</span>
          </span>
        </div>

        <h3 className="mx-1 mb-2.5 mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Banco do cartão</h3>
        <div className="flex flex-wrap gap-2">
          {chips.map((b) => (
            <button key={b.name} type="button" onClick={() => setBank(b)} aria-pressed={bank !== "new" && bank?.name === b.name} data-testid={`card-bank-${b.name}`}
              className={cn("inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold", bank !== "new" && bank?.name === b.name ? "border-2 border-primary bg-primary/[0.07]" : "border border-border bg-card")}>
              <span className="size-3 rounded-full" style={{ background: b.color }} />{b.name}
            </button>
          ))}
          <button type="button" onClick={() => setBank("new")} aria-pressed={bank === "new"} data-testid="card-bank-new"
            className={cn("inline-flex h-11 items-center rounded-full px-3.5 text-sm font-semibold text-primary", bank === "new" ? "border-2 border-solid border-primary bg-primary/[0.07]" : "border border-dashed border-border bg-card")}>+ Banco novo</button>
        </div>
        {bank === "new" ? (
          <div className="mt-3 rounded-[20px] border-2 border-dashed border-primary/40 bg-card p-3.5">
            <label className="block"><span className="mb-2 block text-[13px] font-semibold">Nome do banco novo</span>
              <input id="wallet-institution-name" value={newBank} onChange={(e) => setNewBank(e.target.value)} placeholder="Ex.: Inter, C6, Santander" maxLength={60} className="h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none" /></label>
            <p className="mx-0.5 mt-2.5 text-xs text-muted-foreground">O banco entra na Carteira junto com o cartão, só com o crédito. Se depois você tiver conta nele, é só ativar.</p>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_120px] gap-2.5">
          <label className="block"><span className="mx-1 mb-2 block text-[13px] font-semibold">Nome do cartão</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Roxinho, Cartão da casa" maxLength={60} className={field} data-testid="card-name-input" /></label>
          <label className="block"><span className="mx-1 mb-2 block text-[13px] font-semibold">Final</span>
            <input value={last} onChange={(e) => setLast(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="0000" className={cn(field, "tracking-[0.15em]")} data-testid="card-last-digits-input" /></label>
        </div>
        <p className="mx-1 mb-2 mt-4 text-[13px] font-semibold">Bandeira <span className="font-normal text-muted-foreground">(só para identificar)</span></p>
        <div className="grid grid-cols-4 gap-2">
          {NETWORKS.map((n) => (
            <button key={n.key} type="button" onClick={() => setNetwork(network === n.key ? "" : n.key)} aria-pressed={network === n.key}
              className={cn("h-11 rounded-[14px] text-[13px] font-bold", network === n.key ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{n.label}</button>
          ))}
        </div>

        <div className="mt-4 rounded-3xl border border-border bg-card p-4">
          <label className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Limite</span>
            <input value={limitRaw} onChange={(e) => setLimitRaw(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className="h-11 w-[150px] rounded-[14px] border border-border bg-background px-3 text-right font-heading text-base font-bold outline-none" data-testid="card-limit-input" /></label>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {stepper("Fecha no dia", close, setClose, "Fechamento")}
            {stepper("Vence no dia", due, setDue, "Vencimento")}
          </div>
          <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-3.5 py-3 dark:bg-emerald-500/15">
            <CalendarDays className="size-[18px] shrink-0 text-emerald-700" aria-hidden="true" />
            <span className="text-[13px] text-emerald-900 dark:text-emerald-200">Melhor dia de compra: <strong>dia {wrap(close + 1)}</strong>. Até {term} dias para pagar.</span>
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-3 rounded-3xl border border-border bg-card px-4 py-3.5">
          <span className="flex-1"><span className="block text-[15px] font-semibold">Cartão padrão</span><span className="block text-xs text-muted-foreground">Vem marcado primeiro quando o gasto é no crédito</span></span>
          <span data-testid="card-default-checkbox"><Switch on={isDefault} onChange={setIsDefault} label="Cartão padrão" /></span>
        </div>
        <p className="mx-1 mt-3.5 text-xs text-muted-foreground" data-testid="card-pay-note">A conta que paga a fatura você escolhe na hora de pagar.</p>
        {error ? <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">{error}</p> : null}

        <div className="mt-auto pt-5">
          <button type="button" onClick={() => void save()} disabled={saving} className="h-[54px] w-full rounded-full bg-primary text-[15px] font-bold text-primary-foreground" data-testid="card-submit-button">
            {bank === "new" && issuer ? `Salvar cartão e criar ${issuer.name}` : "Salvar cartão"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
