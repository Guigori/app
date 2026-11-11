import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { History, PencilLine, Plus, Trash2, Undo2, X } from "lucide-react";
import { fetchAccounts, fetchCards, fetchCategories, type HistoryEvent } from "@/lib/data";
import { formatBRL } from "@/lib/format";
import type { TransactionInput } from "@/types/finnos";

const FIELD: Record<string, string> = {
  name: "Nome", value_cents: "Valor", date: "Data", status: "Status", type: "Tipo", category_id: "Categoria",
  account_id: "Conta", card_id: "Cartão", to_account_id: "Destino", origin: "Origem", attachment: "Foto",
};
const TYPE: Record<string, string> = { despesa: "Despesa", receita: "Receita", transferencia: "Transferência" };
const STATUS: Record<string, string> = { pago: "Pago", pendente: "Pendente", agendado: "Agendado", atrasado: "Atrasado" };
const SOURCE: Record<string, string> = { manual: "Registro", apple_pay: "Apple Pay", ai: "IA", import: "Importação", offline: "Offline", sync: "Sincronização" };

/** Field-by-field changes between two summaries ("Valor: R$ 45,00 → R$ 60,00"). */
export function historyChanges(event: HistoryEvent, label: (field: string, v: string | number | undefined) => string) {
  const before = event.before ?? {}; const after = event.after ?? {};
  return Object.keys(FIELD).filter((k) => k in before || k in after).filter((k) => String(before[k] ?? "") !== String(after[k] ?? ""))
    .map((k) => ({ field: FIELD[k], before: label(k, before[k]), after: label(k, after[k]) }));
}

/** Everything that happened to one lançamento: when it was created, each edit with before → after. */
/** Edits made within two minutes of each other read as one change (before of the first → after of the last). */
export function groupEdits(events: HistoryEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.action === "updated" && e.action === "updated" && Math.abs(Date.parse(last.created_at) - Date.parse(e.created_at)) <= 120_000) {
      out[out.length - 1] = { ...last, before: e.before };
    } else out.push(e);
  }
  return out;
}

/** What to send to put back the values from before an edit (only fields that changed and can be edited). */
export function restorePatch(event: HistoryEvent): Partial<TransactionInput> {
  const before = event.before ?? {}; const after = event.after ?? {};
  const patch: Partial<TransactionInput> = {};
  const differs = (k: string) => k in before && String(before[k] ?? "") !== String(after[k] ?? "");
  if (differs("name")) patch.name = String(before.name);
  if (differs("value_cents")) patch.value = Number(before.value_cents) / 100;
  if (differs("date")) patch.date = String(before.date);
  if (differs("category_id")) patch.category_id = String(before.category_id);
  if (differs("account_id")) patch.account_id = String(before.account_id);
  if (differs("card_id")) patch.card_id = String(before.card_id);
  if (differs("to_account_id")) patch.to_account_id = String(before.to_account_id);
  if (differs("origin")) patch.origin = String(before.origin);
  if (differs("status")) patch.status = before.status as TransactionInput["status"];
  return patch;
}

export function HistorySheet({ open, events: raw, onClose, onRestore }: { open: boolean; events: HistoryEvent[]; onClose: () => void; /** Put back the values from before one edit. */ onRestore?: (patch: Partial<TransactionInput>) => void }) {
  const events = useMemo(() => groupEdits(raw), [raw]);
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled: open });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, enabled: open });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const label = (field: string, v: string | number | undefined): string => {
    if (field === "attachment") return v ? "Com foto" : "Sem foto";
    if (v === undefined || v === null || v === "") return "—";
    if (field === "value_cents") return formatBRL(Number(v) / 100);
    if (field === "date") return String(v).split("-").reverse().join("/");
    if (field === "type") return TYPE[String(v)] ?? String(v);
    if (field === "status") return STATUS[String(v)] ?? String(v);
    if (field === "category_id") return categories.data?.find((c) => c.id === v)?.name ?? "Categoria removida";
    if (field === "account_id" || field === "to_account_id") return accounts.data?.find((a) => a.id === v)?.name ?? "Conta removida";
    if (field === "card_id") return cards.data?.find((c) => c.id === v)?.name ?? "Cartão removido";
    return String(v);
  };
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString("pt-BR")} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`; };
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="history" className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 dashboard:items-center" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.div role="dialog" aria-modal="true" aria-label="Histórico de alterações" data-testid="record-history" onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[32px] border border-b-0 border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3.5 text-foreground dashboard:rounded-[28px] dashboard:border-b"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}>
            <div className="mx-auto mb-3 h-[5px] w-20 shrink-0 rounded-full bg-[#2a2b52]" aria-hidden="true" />
            <div className="flex h-11 shrink-0 items-center gap-3">
              <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background"><X size={18} /></button>
              <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[21px] font-bold">Histórico de alterações</h2>
              <History size={20} className="shrink-0 text-[#a78bfa]" aria-hidden="true" />
            </div>
            <ol className="mt-3 min-h-0 flex-1 space-y-0 overflow-y-auto overscroll-contain">
              {events.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</li> : events.map((event, i) => {
                const changes = event.action === "updated" ? historyChanges(event, label) : [];
                const source = (event.after?.source ?? event.before?.source) as string | undefined;
                const Icon = event.action === "created" ? Plus : event.action === "deleted" ? Trash2 : PencilLine;
                const tone = event.action === "created" ? "bg-income/15 text-income dark:bg-[#0d2a22] dark:text-[#34d399]" : event.action === "deleted" ? "bg-expense/15 text-expense dark:bg-[#3a1020] dark:text-[#fb7185]" : "bg-amber-500/15 text-amber-500 dark:bg-[#2a1a0c] dark:text-[#fb923c]";
                return (
                  <motion.li key={event.id} className="relative flex gap-3 pb-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} data-testid="record-history-item">
                    {i < events.length - 1 ? <span className="absolute bottom-0 left-[17px] top-9 w-px bg-border" aria-hidden="true" /> : null}
                    <span className={"grid size-9 shrink-0 place-items-center rounded-full " + tone}><Icon size={16} aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-[15px] font-bold">{event.action === "created" ? "Lançamento criado" : event.action === "deleted" ? "Lançamento excluído" : changes.length === 1 ? `${changes[0].field} alterado` : changes.length ? `${changes.length} campos alterados` : "Lançamento salvo"}</p>
                      <p className="text-xs text-muted-foreground">{when(event.created_at)}{source ? ` · via ${SOURCE[source] ?? source}` : ""}</p>
                      {event.action === "created" && event.after ? (
                        <p className="mt-1.5 text-sm text-muted-foreground">{[event.after.name, label("value_cents", event.after.value_cents), label("date", event.after.date)].filter(Boolean).join(" · ")}</p>
                      ) : null}
                      {changes.length ? (
                        <ul className="mt-2 space-y-1.5 rounded-2xl bg-muted/60 px-3 py-2.5">
                          {changes.map((c) => (
                            <li key={c.field} className="text-sm"><span className="text-muted-foreground">{c.field}: </span><span className="line-through decoration-expense/60 opacity-70">{c.before}</span><span className="mx-1.5 text-muted-foreground">→</span><span className="font-semibold">{c.after}</span></li>
                          ))}
                        </ul>
                      ) : null}
                      {onRestore && changes.length && i === 0 && Object.keys(restorePatch(event)).length ? (
                        <button type="button" onClick={() => onRestore(restorePatch(event))} data-testid="record-history-restore" className="mt-2 flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-semibold"><Undo2 size={15} className="text-[#a78bfa]" aria-hidden="true" />Desfazer esta alteração</button>
                      ) : null}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
