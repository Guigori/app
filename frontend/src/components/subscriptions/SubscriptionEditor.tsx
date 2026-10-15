import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CreditCard, Wallet } from "lucide-react";
import { fetchAccounts, fetchCards, fetchCategories } from "@/lib/data";
import type { SubscriptionInput, SubscriptionItem } from "@/types/finnos";

type Props = {
  original?: SubscriptionItem | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: SubscriptionInput) => Promise<void>;
};

const field = "mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-[#4B2CFF]";

function inputFor(original?: SubscriptionItem | null): SubscriptionInput {
  return original ? {
    name: original.name,
    value: original.value,
    recurrence: original.recurrence,
    next_charge: original.next_charge,
    account_id: original.account_id,
    category_id: original.category_id,
    card_id: original.card_id,
    active: original.active,
    notes: original.notes ?? null,
  } : {
    name: "",
    value: 0,
    recurrence: "mensal",
    next_charge: new Date().toISOString().slice(0, 10),
    account_id: "",
    category_id: null,
    card_id: null,
    active: true,
    notes: null,
  };
}

export default function SubscriptionEditor({ original, saving, error, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<SubscriptionInput>(() => inputFor(original));
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });

  const set = <K extends keyof SubscriptionInput>(key: K, value: SubscriptionInput[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));

  const valid = Boolean(
    draft.name.trim() && draft.name.trim().length <= 100 &&
    Number.isFinite(draft.value) && draft.value > 0 &&
    draft.next_charge && draft.account_id,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    await onSave({ ...draft, name: draft.name.trim() });
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" aria-label={original ? `Editar assinatura ${original.name}` : "Nova assinatura"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[#4B2CFF] dark:text-[#A46DFF]">FINNOS · ASSINATURAS</p>
          <h2 className="mt-2 text-xl font-bold text-foreground">{original ? "Editar assinatura" : "Nova assinatura"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cadastre o serviço sem criar uma despesa financeira automaticamente.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-border p-3" aria-label="Voltar às assinaturas">
          <ArrowLeft size={18} />
        </button>
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Nome do serviço
          <input className={field} value={draft.name} maxLength={100} onChange={e => set("name", e.target.value)} placeholder="Ex.: Spotify Premium" required />
        </label>
        <label className="block text-sm font-medium">Valor da cobrança (R$)
          <input className={field} type="number" min="0.01" step="0.01" value={draft.value || ""} onChange={e => set("value", Number(e.target.value))} required />
        </label>
        <label className="block text-sm font-medium">Periodicidade
          <select className={field} value={draft.recurrence} onChange={e => set("recurrence", e.target.value as SubscriptionInput["recurrence"])}>
            <option value="mensal">Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Próxima cobrança
          <input className={field} type="date" value={draft.next_charge} onChange={e => set("next_charge", e.target.value)} required />
        </label>
        <label className="block text-sm font-medium">Conta de cobrança
          <span className="relative block"><Wallet className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 text-muted-foreground" />
            <select className={field + " pl-9"} value={draft.account_id} onChange={e => set("account_id", e.target.value)} required>
              <option value="">Selecione uma conta</option>
              {(accounts.data ?? []).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </span>
        </label>
        <label className="block text-sm font-medium">Cartão (opcional)
          <span className="relative block"><CreditCard className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 text-muted-foreground" />
            <select className={field + " pl-9"} value={draft.card_id ?? ""} onChange={e => set("card_id", e.target.value || null)}>
              <option value="">Sem cartão</option>
              {(cards.data ?? []).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
            </select>
          </span>
        </label>
        <label className="block text-sm font-medium sm:col-span-2">Categoria (opcional)
          <select className={field} value={draft.category_id ?? ""} onChange={e => set("category_id", e.target.value || null)}>
            <option value="">Sem categoria</option>
            {(categories.data ?? []).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium sm:col-span-2">Observações (opcional)
          <textarea className={field} rows={3} maxLength={500} value={draft.notes ?? ""} onChange={e => set("notes", e.target.value || null)} placeholder="Plano contratado, observações de renovação ou cancelamento…" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
          <input type="checkbox" checked={draft.active} onChange={e => set("active", e.target.checked)} />
          Assinatura ativa
        </label>
        {error && <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" disabled={!valid || saving} className="inline-flex items-center gap-2 rounded-full bg-[#4B2CFF] px-5 py-3 font-semibold text-white disabled:opacity-50">
            <Check size={17} /> {saving ? "Salvando..." : original ? "Salvar alterações" : "Adicionar assinatura"}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-border px-5 py-3">Cancelar</button>
        </div>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">O FINNOS acompanha o valor previsto. Nenhum pagamento ou lançamento bancário é criado por este cadastro.</p>
    </section>
  );
}
