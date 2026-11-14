import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarRange, Check, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecurrenceEditScope } from "@/lib/data";
import { useDragToClose } from "@/lib/gestures/useDragToClose";

const OPTIONS: [RecurrenceEditScope, string, string][] = [
  ["esta", "Só este lançamento", "Os outros meses da série continuam como estão."],
  ["proximas", "Este e os próximos", "Nome e valor mudam daqui para frente. Meses passados não mudam."],
  ["todas", "Toda a série futura", "Só para séries sem nenhum mês pago."],
];

/** Saving an edit to a monthly series: which occurrences it applies to. */
export function SeriesScopeSheet({ open, canEditAll, otherFields, accent, onPick, onClose }: {
  open: boolean; canEditAll: boolean; otherFields: boolean; accent: string; onPick: (scope: RecurrenceEditScope) => void; onClose: () => void;
}) {
  const drag = useDragToClose(onClose, { whole: true });
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="scope" className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 dashboard:items-center" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-label="Aplicar a alteração" data-testid="recurrence-scope-dialog" onClick={(e) => e.stopPropagation()} {...drag.panel}
            className="w-full max-w-md rounded-t-[32px] border border-b-0 border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3.5 text-foreground dashboard:rounded-[28px] dashboard:border-b"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}>
            <div className="mx-auto mb-3 h-[5px] w-20 rounded-full bg-[#2a2b52]" aria-hidden="true" />
            <h2 className="flex items-center gap-2 text-[21px] font-bold"><Repeat size={20} className="text-[#a78bfa]" aria-hidden="true" />Este lançamento se repete</h2>
            <p className="mt-1 text-sm text-muted-foreground">Onde aplicar a alteração?</p>
            <div className="mt-4 flex flex-col gap-2">
              {OPTIONS.map(([scope, label, hint]) => {
                const disabled = scope === "todas" && !canEditAll;
                return (
                  <button key={scope} type="button" disabled={disabled} onClick={() => onPick(scope)} data-testid={`scope-${scope}`}
                    className={cn("flex items-center gap-3 rounded-3xl border-[1.5px] border-transparent bg-muted px-4 py-3 text-left disabled:opacity-40")}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}>
                      {scope === "esta" ? <Check size={18} /> : <CalendarRange size={18} />}
                    </span>
                    <span className="min-w-0"><span className="block text-[15px] font-bold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                  </button>
                );
              })}
            </div>
            {otherFields ? <p className="mt-3 text-xs text-muted-foreground">Categoria, conta, data e nota mudam só neste lançamento.</p> : null}
            <button type="button" onClick={onClose} className="mt-3 h-12 w-full rounded-full text-[15px] font-semibold text-muted-foreground">Cancelar</button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
