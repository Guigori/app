import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Trash2 } from "lucide-react";

type Kind = "Despesa" | "Receita" | "Transferência";
const KEEP_BG: Record<Kind, string> = { Despesa: "bg-[#e11d48]", Receita: "bg-[#047857]", "Transferência": "bg-[#7c3aed]" };

/** "Descartar este registro?" as in the prototype: centred card, keep editing first, discard second. */
export function DiscardRegisterDialog({ open, kind, onKeep, onDiscard, title = "Descartar este registro?", text = "Você já começou a preencher. Se fechar agora, o valor e os dados digitados serão perdidos.", keepLabel = "Continuar editando", discardLabel = "Descartar e fechar" }: { open: boolean; kind: Kind; onKeep: () => void; onDiscard: () => void; title?: string; text?: string; keepLabel?: string; discardLabel?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onKeep(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeep]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="discard" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-7" onClick={onKeep}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-text" onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col items-center gap-3.5 rounded-[28px] border border-[#2f3060] bg-card px-5 pb-5 pt-6 text-center"
            initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
            <span className="grid size-[52px] place-items-center rounded-full bg-expense/15 text-expense dark:bg-[#3a1020] dark:text-[#fb7185]"><Trash2 size={22} aria-hidden="true" /></span>
            <h2 id="discard-title" className="text-[21px] font-bold">{title}</h2>
            <p id="discard-text" className="text-sm leading-[1.45] text-muted-foreground">{text}</p>
            <div className="mt-1.5 flex w-full flex-col gap-2.5">
              <button type="button" autoFocus onClick={onKeep} data-testid="confirm-dialog-cancel-button" className={"h-[50px] rounded-full text-[15px] font-bold text-white " + KEEP_BG[kind]}>{keepLabel}</button>
              <button type="button" onClick={onDiscard} data-testid="confirm-dialog-confirm-button" className="h-[50px] rounded-full border border-[#5b1a2e] text-[15px] font-bold text-expense dark:text-[#fb7185]">{discardLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
