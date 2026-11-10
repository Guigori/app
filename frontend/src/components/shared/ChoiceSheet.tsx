import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

export interface Choice { key: string; label: string; hint?: string; icon?: ReactNode }

/** A short question at the bottom of the screen with a few answers, in the register's style. */
export function ChoiceSheet({ open, title, text, choices, accent = "#a78bfa", onPick, onClose, testId }: {
  open: boolean; title: string; text?: string; choices: Choice[]; accent?: string; onPick: (key: string) => void; onClose: () => void; testId?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="choice" className="fixed inset-0 z-[86] flex items-end justify-center bg-black/60 dashboard:items-center" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[32px] border border-b-0 border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3.5 text-foreground dashboard:rounded-[28px] dashboard:border-b"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}>
            <div className="mx-auto mb-3 h-[5px] w-20 rounded-full bg-[#2a2b52]" aria-hidden="true" />
            <h2 className="text-[21px] font-bold">{title}</h2>
            {text ? <p className="mt-1 text-sm text-muted-foreground">{text}</p> : null}
            <div className="mt-4 flex flex-col gap-2">
              {choices.map((c) => (
                <button key={c.key} type="button" onClick={() => onPick(c.key)} data-testid={`choice-${c.key}`} className="flex items-center gap-3 rounded-3xl bg-muted px-4 py-3 text-left">
                  {c.icon ? <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}>{c.icon}</span> : null}
                  <span className="min-w-0"><span className="block text-[15px] font-bold">{c.label}</span>{c.hint ? <span className="block text-xs text-muted-foreground">{c.hint}</span> : null}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} className="mt-3 h-12 w-full rounded-full text-[15px] font-semibold text-muted-foreground">Cancelar</button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
