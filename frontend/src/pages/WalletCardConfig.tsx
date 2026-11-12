import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { deleteCard, fetchCards, setDefaultCard, updateCard } from "@/lib/data";
import { cardGradient } from "@/lib/cardGradient";
import { formatBRL, formatHiddenBRL, parseAmount } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useOwnHeader } from "@/components/layout/BackButton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Switch } from "@/components/wallet/FormParts";
import { cardInput, sectionTitle } from "@/lib/walletForms";
import type { CardNetwork } from "@/types/finnos";

const NETWORKS: { key: CardNetwork; label: string }[] = [{ key: "visa", label: "Visa" }, { key: "master", label: "Master" }, { key: "elo", label: "Elo" }, { key: "amex", label: "Amex" }];
const wrap = (d: number) => ((d - 1 + 31) % 31) + 1;

function Stepper({ label, value, onChange, aria }: { label: string; value: number; onChange: (v: number) => void; aria: string }) {
  return (
    <div className="rounded-[18px] bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <button type="button" onClick={() => onChange(wrap(value - 1))} aria-label={`${aria} um dia antes`} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
        <strong className="font-heading text-[22px]">{value}</strong>
        <button type="button" onClick={() => onChange(wrap(value + 1))} aria-label={`${aria} um dia depois`} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
      </div>
    </div>
  );
}

/** Prototype "8 · Configurar cartão". */
export default function WalletCardConfig() {
  const { cardId = "" } = useParams();
  useOwnHeader();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hidden } = useBalanceHidden();
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const card = cardsQuery.data?.find((c) => c.id === cardId);
  const [name, setName] = useState("");
  const [last, setLast] = useState("");
  const [network, setNetwork] = useState<CardNetwork | "">("");
  const [limitRaw, setLimitRaw] = useState("");
  const [close, setClose] = useState(1);
  const [due, setDue] = useState(10);
  const [isDefault, setIsDefault] = useState(false);
  const [limitAlert, setLimitAlert] = useState(false);
  const [remindOn, setRemindOn] = useState(true);
  const [remind, setRemind] = useState(7);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!card || loaded) return;
    setName(card.name); setLast(card.last_digits ?? ""); setNetwork(card.network ?? ""); setLimitRaw(String(card.limit).replace(".", ","));
    setClose(card.closing_day); setDue(card.due_day); setIsDefault(Boolean(card.is_default)); setLimitAlert(Boolean(card.limit_alert));
    setRemindOn(card.invoice_reminder !== false); setRemind(card.remind_days ?? 7); setLoaded(true);
  }, [card, loaded]);

  const refresh = () => Promise.all(["cards", "invoice", "notifications"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const save = useMutation({
    mutationFn: async () => {
      if (!card) return;
      const limit = parseAmount(limitRaw);
      if (!name.trim()) throw new Error("Dê um nome ao cartão.");
      if (!limit || limit <= 0) throw new Error("Informe o limite total.");
      if (last && !/^\d{4}$/.test(last)) throw new Error("O final do cartão tem 4 números.");
      await updateCard(card.id, cardInput(card, {
        name: name.trim(), limit, closing_day: close, due_day: due, last_digits: last, network,
        limit_alert: limitAlert, invoice_reminder: remindOn, remind_days: remind,
      }));
      if (isDefault && !card.is_default) await setDefaultCard(card.id);
    },
    onSuccess: async () => { toast.success("Cartão atualizado."); await refresh(); navigate(-1); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: async () => card && updateCard(card.id, cardInput(card, { active: false })),
    onSuccess: async () => { toast.success("Cartão arquivado. As faturas antigas ficam nas análises."); await refresh(); navigate("/contas"); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: async () => card && deleteCard(card.id),
    onSuccess: async () => { toast.success("Cartão excluído."); await refresh(); navigate("/contas"); },
    onError: (error) => { setConfirm(null); toast.error(getApiErrorMessage(error)); },
  });

  if (cardsQuery.isPending) return <FinnosPageLoading title="Carregando cartão" description="Buscando a configuração." />;
  if (!card) return <p className="py-10 text-center text-muted-foreground">Cartão não encontrado. <Link to="/contas" className="font-semibold text-primary">Voltar</Link></p>;
  const limit = parseAmount(limitRaw) ?? card.limit;
  const field = "h-12 w-full rounded-[14px] border border-border bg-background px-3.5 text-[15px] outline-none focus:border-primary";
  const row = "flex items-center gap-3 border-b border-border/60 px-4 py-3.5";

  return (
    <div className="mx-auto w-full max-w-[560px] pb-10" data-testid="card-config">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></button>
        <h1 className="min-w-0 flex-1 font-heading text-xl font-bold">Configurar cartão</h1>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="h-10 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="card-config-save">Salvar</button>
      </header>

      <div className="mt-3.5 flex h-[200px] flex-col justify-between rounded-3xl p-5 text-white" style={{ background: cardGradient(card.color), boxShadow: `0 22px 44px -22px ${card.color}` }} data-testid="card-config-preview">
        <span className="flex items-center gap-2">
          <span><span className="block font-heading text-[22px] font-bold">{name || "Sem nome"}</span><span className="block text-xs opacity-85">{card.institution} · crédito</span></span>
          {isDefault ? <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">Padrão</span> : null}
        </span>
        <span className="flex items-end justify-between">
          <span><span className="block text-[11px] opacity-80">Limite</span><span className="block font-heading text-xl font-bold tabular-nums">{hidden ? formatHiddenBRL() : formatBRL(limit)}</span></span>
          <span className="text-sm opacity-90">{/^\d{4}$/.test(last) ? `•••• ${last}` : ""}</span>
        </span>
      </div>

      <h2 className={sectionTitle}>Identificação</h2>
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2.5">
          <label className="block"><span className="mb-2 block text-[13px] font-semibold">Nome do cartão</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Roxinho" maxLength={60} className={field} data-testid="card-config-name" /></label>
          <label className="block"><span className="mb-2 block text-[13px] font-semibold">Final</span>
            <input value={last} onChange={(e) => setLast(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} className={cn(field, "tracking-[0.15em]")} data-testid="card-config-last" /></label>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold">Bandeira <span className="font-normal text-muted-foreground">(só para identificar)</span></p>
          <div className="grid grid-cols-4 gap-2">
            {NETWORKS.map((n) => (
              <button key={n.key} type="button" onClick={() => setNetwork(network === n.key ? "" : n.key)} aria-pressed={network === n.key}
                className={cn("h-11 rounded-[14px] text-[13px] font-bold", network === n.key ? "border-2 border-primary bg-primary/[0.07] text-primary" : "border border-border bg-card")}>{n.label}</button>
            ))}
          </div>
        </div>
      </div>

      <h2 className={sectionTitle}>Limite e datas</h2>
      <div className="rounded-3xl border border-border bg-card p-4">
        <label className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Limite total</span>
          <input value={limitRaw} onChange={(e) => setLimitRaw(e.target.value)} inputMode="decimal" className="h-11 w-[150px] rounded-[14px] border border-border bg-background px-3 text-right font-heading text-base font-bold outline-none" data-testid="card-config-limit" /></label>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Stepper label="Fecha no dia" value={close} onChange={setClose} aria="Fechamento" />
          <Stepper label="Vence no dia" value={due} onChange={setDue} aria="Vencimento" />
        </div>
        <p className="mx-0.5 mt-3.5 text-[13px] text-muted-foreground">Melhor dia de compra: <strong className="text-foreground">dia {wrap(close + 1)}</strong>. Mudar as datas vale a partir da próxima fatura.</p>
      </div>

      <h2 className={sectionTitle}>Uso e avisos</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className={row}><span className="flex-1"><span className="block text-[15px] font-semibold">Cartão padrão</span><span className="block text-xs text-muted-foreground">Vem marcado primeiro quando o gasto é no crédito</span></span><Switch on={isDefault} onChange={setIsDefault} label="Cartão padrão" /></div>
        <div className={row}><span className="flex-1"><span className="block text-[15px] font-semibold">Avisar com 80% do limite</span><span className="block text-xs text-muted-foreground">Notificação quando o limite estiver quase no fim</span></span><Switch on={limitAlert} onChange={setLimitAlert} label="Avisar com 80% do limite" /></div>
        <div className={cn(row, !remindOn && "border-b-0")}><span className="flex-1"><span className="block text-[15px] font-semibold">Lembrar da fatura</span><span className="block text-xs text-muted-foreground">Aviso antes do vencimento</span></span><Switch on={remindOn} onChange={setRemindOn} label="Lembrar da fatura" /></div>
        {remindOn ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3.5" data-testid="card-config-remind">
            <span className="text-sm">Lembrar antes do vencimento</span>
            <span className="flex items-center gap-2.5">
              <button type="button" onClick={() => setRemind((v) => Math.max(1, v - 1))} aria-label="Menos dias" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
              <strong className="min-w-16 text-center text-sm">{remind === 1 ? "1 dia" : `${remind} dias`}</strong>
              <button type="button" onClick={() => setRemind((v) => Math.min(10, v + 1))} aria-label="Mais dias" className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
            </span>
          </div>
        ) : null}
      </div>

      <h2 className={sectionTitle}>Avançado</h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <Link to={`/cartoes/${encodeURIComponent(card.id)}`} className="flex items-center justify-between border-b border-border/60 p-4 text-[15px] font-semibold">Faturas anteriores<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>
        <button type="button" onClick={() => setConfirm("archive")} className="block w-full border-b border-border/60 p-4 text-left text-[15px] font-semibold" data-testid="card-config-archive">
          Arquivar cartão<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Para quando cancelar. As faturas antigas ficam nas análises.</span></button>
        <button type="button" onClick={() => setConfirm("delete")} className="block w-full p-4 text-left text-[15px] font-semibold text-expense" data-testid="card-config-delete">
          Excluir cartão<span className="mt-0.5 block text-xs font-normal text-muted-foreground">Pede confirmação. Cartão com compras não pode ser excluído: arquive.</span></button>
      </div>

      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm === "delete" ? "Excluir cartão?" : "Arquivar cartão?"}
        description={confirm === "delete" ? `"${card.name}" será removido. Se tiver compras, a exclusão é recusada e você pode arquivar.` : `"${card.name}" some da Carteira. As faturas antigas continuam nas análises.`}
        confirmLabel={confirm === "delete" ? "Excluir" : "Arquivar"} destructive={confirm === "delete"} loading={archive.isPending || remove.isPending}
        onConfirm={() => (confirm === "delete" ? remove.mutate() : archive.mutate())} />
    </div>
  );
}
