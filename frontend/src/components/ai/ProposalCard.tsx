import { useState } from "react";
import { Check, Loader2, Undo2 } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { parseBRNumber } from "@/lib/registerParsing";
import { cn } from "@/lib/utils";
import type { Proposal, ProposalState } from "@/lib/finnActions";
import type { Account, Category } from "@/types/finnos";

interface Props {
  proposal: Proposal;
  state: ProposalState;
  categories: Category[];
  accounts: Account[];
  onChange: (proposal: Proposal) => void;
  onApply: () => Promise<void>;
  onCancel: () => void;
  onUndo: () => Promise<void>;
}

const Tick = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
    className={cn("grid size-7 shrink-0 place-items-center rounded-full border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-transparent")}>
    <Check className="h-4 w-4" aria-hidden="true" />
  </button>
);

/** A change FINNOS IA prepared: the user can untick, correct and confirm it. Nothing is saved before that. */
export function ProposalCard({ proposal, state, categories, accounts, onChange, onApply, onCancel, onUndo }: Props) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } finally { setBusy(false); } };
  const count = proposal.kind === "register" ? proposal.entries.filter((e) => e.include).length
    : proposal.kind === "recategorize" ? proposal.ids.length : proposal.candidates.filter((c) => c.include).length;
  const verb = proposal.kind === "register" ? "Registrar" : proposal.kind === "recategorize" ? "Aplicar" : "Cadastrar";
  const pending = state.status === "pending";

  return (
    <div className="mt-3 space-y-2" data-testid="ai-proposal">
      {proposal.kind === "register" ? proposal.entries.map((e, i) => {
        const set = (patch: Partial<typeof e>) => onChange({ ...proposal, entries: proposal.entries.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div key={e.key} className={cn("flex items-center gap-2 rounded-xl border border-border bg-background p-2.5", !e.include && "opacity-50")} data-testid="ai-proposal-entry">
            <div className="min-w-0 flex-1 space-y-1">
              <input aria-label="Descrição" value={e.name} disabled={!pending} onChange={(ev) => set({ name: ev.target.value })} className="w-full bg-transparent text-sm font-semibold outline-none" />
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <select aria-label="Categoria" value={e.categoryId ?? ""} disabled={!pending} onChange={(ev) => set({ categoryId: ev.target.value || null })} className="max-w-[9rem] rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                  <option value="">Sem categoria</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select aria-label="Conta" value={e.accountId} disabled={!pending} onChange={(ev) => set({ accountId: ev.target.value })} className="max-w-[8rem] rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                  {accounts.filter((a) => a.active !== false).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span>{formatDate(e.date)}</span>
              </div>
            </div>
            <label className={cn("flex shrink-0 items-center text-sm font-semibold tabular-nums", e.type === "receita" ? "text-income" : "text-expense")}>
              {e.type === "receita" ? "+" : "−"}
              <input aria-label={`Valor de ${e.name}`} inputMode="decimal" defaultValue={e.value.toFixed(2).replace(".", ",")} disabled={!pending}
                onBlur={(ev) => { const v = parseBRNumber(ev.target.value); if (v > 0) set({ value: v }); }}
                className="w-16 bg-transparent text-right outline-none" />
            </label>
            {pending ? <Tick on={e.include} onClick={() => set({ include: !e.include })} label={e.include ? `Não registrar ${e.name}` : `Registrar ${e.name}`} /> : null}
          </div>
        );
      }) : null}

      {proposal.kind === "recategorize" ? (
        <div className="rounded-xl border border-border bg-background p-3 text-sm" data-testid="ai-proposal-recategorize">
          <p className="font-semibold">{proposal.term.charAt(0).toUpperCase() + proposal.term.slice(1)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Categoria: {proposal.from.map((f) => f.name).join(", ")} → <span className="font-semibold text-foreground">{proposal.toName}</span></p>
          <p className="text-xs text-muted-foreground">Lançamentos: {proposal.ids.length} · {formatBRL(proposal.total)}</p>
        </div>
      ) : null}

      {proposal.kind === "subscriptions" ? proposal.candidates.map((c, i) => (
        <div key={c.key} className={cn("flex items-center gap-2 rounded-xl border border-border bg-background p-2.5", !c.include && "opacity-50")} data-testid="ai-proposal-subscription">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{c.name}</p>
            <p className="truncate text-xs text-muted-foreground">próxima {formatDate(c.nextCharge)} · todo mês · visto em {c.months} meses</p>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-expense">−{formatBRL(c.value)}</span>
          {pending ? <Tick on={c.include} onClick={() => onChange({ ...proposal, candidates: proposal.candidates.map((x, j) => (j === i ? { ...x, include: !x.include } : x)) })} label={c.include ? `Não cadastrar ${c.name}` : `Cadastrar ${c.name}`} /> : null}
        </div>
      )) : null}

      {pending ? (
        <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-xl bg-muted px-4 text-sm font-semibold hover:bg-muted/70">Cancelar</button>
          <button type="button" onClick={() => void run(onApply)} disabled={busy || !count} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="ai-proposal-apply">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{verb} · {count}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm" data-testid="ai-proposal-status">
          <span className="font-medium">{state.status === "applied" ? `Feito · ${(state.createdIds ?? state.previous ?? state.subscriptionIds ?? []).length}` : state.status === "undone" ? "Desfeito" : "Cancelado"}</span>
          {state.status === "applied" ? (
            <button type="button" onClick={() => void run(onUndo)} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="ai-proposal-undo">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}Desfazer
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
