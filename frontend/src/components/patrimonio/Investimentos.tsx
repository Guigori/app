import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { INVESTMENT_KINDS, investmentTotals, listInvestments, removeInvestment, saveInvestment, type Investment, type InvestmentInput } from "@/lib/investments";
import { formatDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const parse = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));
const field = "mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm";

/** Patrimônio → Investimentos: positions typed in by the user, their total and the return. */
export function Investimentos({ userId, display }: { userId: string; display: (n: number) => string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["investments", userId], queryFn: () => listInvestments(userId) });
  const rows = query.data ?? [];
  const totals = investmentTotals(rows);
  const [editing, setEditing] = useState<Investment | "new" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["investments"] });

  return (
    <section className="space-y-4" data-testid="investments">
      <div className="grid grid-cols-3 gap-2">
        {[{ label: "Aplicado", value: display(totals.invested) }, { label: "Valor atual", value: display(totals.current) }, { label: "Rendimento", value: `${totals.gain >= 0 ? "+" : "−"}${display(Math.abs(totals.gain))}`, note: totals.gainPct !== null ? `${totals.gainPct >= 0 ? "+" : ""}${totals.gainPct.toLocaleString("pt-BR")}%` : null, tone: totals.gain >= 0 ? "text-income" : "text-expense" }].map((t) => (
          <div key={t.label} className="min-w-0 rounded-2xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={cn("mt-1 whitespace-nowrap text-[clamp(0.85rem,4vw,1.1rem)] font-bold tabular-nums", "tone" in t && t.tone)}>{t.value}</p>
            {"note" in t && t.note ? <p className={cn("text-xs tabular-nums", t.tone)}>{t.note}</p> : null}
          </div>
        ))}
      </div>

      {query.isPending ? <p className="text-sm text-muted-foreground">Carregando…</p> : rows.length === 0 && editing === null ? (
        <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Cadastre suas aplicações (CDB, Tesouro, ações…) e atualize o valor de vez em quando para ver o patrimônio completo.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((r) => {
            const gain = r.current - r.invested;
            return editing !== "new" && editing?.id === r.id ? (
              <li key={r.id} className="p-3"><InvestmentForm initial={r} onCancel={() => setEditing(null)} onSave={async (input) => { await saveInvestment(userId, input, r.id); await refresh(); setEditing(null); toast.success("Investimento atualizado."); }} /></li>
            ) : (
              <li key={r.id} className="flex items-center gap-3 px-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{INVESTMENT_KINDS.find((k) => k.value === r.kind)?.label} · atualizado em {formatDate(r.updated_on)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">{display(r.current)}</span>
                  <span className={cn("block text-xs tabular-nums", gain >= 0 ? "text-income" : "text-expense")}>{gain >= 0 ? "+" : "−"}{display(Math.abs(gain))}</span>
                </span>
                <button type="button" onClick={() => setEditing(r)} className="grid size-9 place-items-center rounded-full hover:bg-muted" aria-label={`Atualizar ${r.name}`}><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={async () => { if (!window.confirm(`Remover ${r.name}? O dinheiro não é movimentado.`)) return; await removeInvestment(userId, r.id); await refresh(); }} className="grid size-9 place-items-center rounded-full text-destructive hover:bg-muted" aria-label={`Remover ${r.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            );
          })}
          {editing === "new" ? <li className="p-3"><InvestmentForm onCancel={() => setEditing(null)} onSave={async (input) => { await saveInvestment(userId, input); await refresh(); setEditing(null); toast.success("Investimento cadastrado."); }} /></li> : null}
        </ul>
      )}
      {editing === null ? (
        <button type="button" onClick={() => setEditing("new")} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="investment-add"><Plus className="h-4 w-4" />Adicionar investimento</button>
      ) : null}
      <p className="text-xs text-muted-foreground">Os valores são informados por você; o FINNOS não acessa corretoras e nada é movimentado.</p>
    </section>
  );
}

function InvestmentForm({ initial, onSave, onCancel }: { initial?: Investment; onSave: (input: InvestmentInput) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "renda_fixa");
  const [invested, setInvested] = useState(initial ? String(initial.invested).replace(".", ",") : "");
  const [current, setCurrent] = useState(initial ? String(initial.current).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const valid = name.trim() && parse(invested) >= 0 && parse(current) >= 0 && invested !== "" && current !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), kind, invested: parse(invested), current: parse(current), updated_on: todayISO(), account: initial?.account ?? null, notes: initial?.notes ?? null });
    } catch {
      toast.error("Não foi possível salvar o investimento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2" data-testid="investment-form">
      <label className="col-span-2 text-xs font-medium">Nome<input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: CDB Banco X 110% CDI" /></label>
      <label className="col-span-2 text-xs font-medium">Tipo<select className={field} value={kind} onChange={(e) => setKind(e.target.value as InvestmentInput["kind"])}>{INVESTMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      <label className="text-xs font-medium">Aplicado (R$)<input className={field} inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} /></label>
      <label className="text-xs font-medium">Valor atual (R$)<input className={field} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
        <button type="submit" disabled={!valid || busy} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}
