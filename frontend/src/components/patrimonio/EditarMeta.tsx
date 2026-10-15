import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { fetchAccounts } from "@/lib/data";
import { deleteGoal, updateGoal, type FinnosGoal } from "@/lib/goals";

type Props = {
  goal: FinnosGoal;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
};

const field = "mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-[#4B2CFF]";
const caption = "block text-sm font-medium text-foreground";

export default function EditarMeta({ goal, userId, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<FinnosGoal>(goal);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const set = <K extends keyof FinnosGoal>(key: K, value: FinnosGoal[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));

  const valid = Boolean(
    draft.name.trim() && draft.category.trim() &&
    draft.target > 0 && draft.saved >= 0 && draft.saved <= draft.target &&
    draft.months >= 1 && draft.months <= 1200 &&
    draft.contribution >= 0 && draft.account,
  );

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateGoal(userId, { ...draft, name: draft.name.trim(), category: draft.category.trim() });
      onSaved();
    } catch {
      setError("Não foi possível atualizar esta meta. Verifique a conta e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmDelete || busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteGoal(userId, goal.id);
      onSaved();
    } catch {
      setError("Não foi possível excluir esta meta. Tente novamente.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" aria-label={`Editar meta ${goal.name}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#4B2CFF] dark:text-[#A46DFF]">FINNOS · METAS</p>
          <h2 className="mt-1 text-xl font-bold text-foreground">Editar meta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ajuste seu planejamento sem movimentar o saldo bancário.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-border p-3" aria-label="Voltar às metas">
          <ArrowLeft size={19} />
        </button>
      </div>

      <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={caption}>Nome da meta
          <input className={field} maxLength={100} value={draft.name} onChange={event => set("name", event.target.value)} required />
        </label>
        <label className={caption}>Categoria
          <input className={field} maxLength={100} value={draft.category} onChange={event => set("category", event.target.value)} required />
        </label>
        <label className={caption}>Objetivo (R$)
          <input className={field} type="number" min="0.01" step="0.01" value={draft.target} onChange={event => set("target", Number(event.target.value))} required />
        </label>
        <label className={caption}>Valor planejado já reservado (R$)
          <input className={field} type="number" min="0" max={draft.target} step="0.01" value={draft.saved} onChange={event => set("saved", Number(event.target.value))} required />
        </label>
        <label className={caption}>Prazo (meses)
          <input className={field} type="number" min="1" max="1200" step="1" value={draft.months} onChange={event => set("months", Number(event.target.value))} required />
        </label>
        <label className={caption}>Valor por aporte (R$)
          <input className={field} type="number" min="0" step="0.01" value={draft.contribution} onChange={event => set("contribution", Number(event.target.value))} required />
        </label>
        <label className={caption}>Frequência
          <select className={field} value={draft.frequency} onChange={event => set("frequency", event.target.value)}>
            <option value="Mensal">Mensal</option>
            <option value="Quinzenal">Quinzenal</option>
            <option value="Semanal">Semanal</option>
          </select>
        </label>
        <label className={caption}>Conta de referência
          <select className={field} value={draft.account} onChange={event => set("account", event.target.value)} required>
            <option value="">Selecione uma conta</option>
            {(accounts.data ?? []).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <div className="sm:col-span-2 flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.remind} onChange={event => set("remind", event.target.checked)} />
            Lembrar aportes
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.radar} onChange={event => set("radar", event.target.checked)} />
            Alertas do Radar
          </label>
        </div>
        {error && <p className="sm:col-span-2 text-sm text-destructive" role="alert">{error}</p>}
        <div className="sm:col-span-2 flex flex-wrap gap-3">
          <button type="submit" disabled={!valid || busy} className="inline-flex items-center gap-2 rounded-full bg-[#4B2CFF] px-5 py-3 font-semibold text-white disabled:opacity-50">
            <Check size={17} /> {busy ? "Salvando..." : "Salvar alterações"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-border px-5 py-3">Cancelar</button>
        </div>
      </form>

      <div className="mt-6 border-t border-border pt-5">
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-2 text-sm font-medium text-destructive">
            <Trash2 size={16} /> Excluir esta meta
          </button>
        ) : (
          <div className="rounded-2xl border border-destructive/40 p-4">
            <p className="text-sm font-semibold">Excluir “{goal.name}”?</p>
            <p className="mt-1 text-sm text-muted-foreground">O planejamento será removido permanentemente. Contas e transações não serão alteradas.</p>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={remove} disabled={busy} className="rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50">Confirmar exclusão</button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="rounded-full border border-border px-4 py-2 text-sm">Manter meta</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
