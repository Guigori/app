import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import type { RegisterController } from "@/pages/SmartRegister";
const SmartRegister = lazy(() => import("@/pages/SmartRegister"));

/** Desktop "+": opens the register in a drawer on the right (no on-screen keypad; the keyboard types the amount).
 *  On mobile the central button in the bottom bar owns it. Same ✕ / ✓ states and discard question as there. */
export function QuickActionFAB() {
  const [open, setOpenRaw] = useState(false);
  const [controller, setController] = useState<RegisterController | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const setOpen = (next: boolean) => { setOpenRaw(next); if (!next) { setController(null); setDiscardOpen(false); } };
  const dirty = open && controller?.view === "entry" && controller.dirty;
  const requestClose = () => { if (dirty) setDiscardOpen(true); else setOpen(false); };
  const kindBg = controller?.kind === "Despesa" ? "bg-expense" : controller?.kind === "Receita" ? "bg-income" : "bg-primary";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !dirty && !discardOpen) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dirty, discardOpen]);

  const onClick = () => {
    if (!open) { setOpen(true); return; }
    if (dirty && controller) {
      if (controller.canSave && !controller.saving) controller.save();
      else toast(controller.hint ?? "Informe o valor para salvar");
      return;
    }
    setOpen(false);
  };

  return (
    <>
      <AnimatePresence>
        {open ? (
          <>
            <motion.button type="button" aria-label="Fechar registro" onClick={requestClose} className="fixed inset-0 z-[39] hidden bg-black/30 backdrop-blur-[6px] dashboard:block"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            <motion.aside role="dialog" aria-modal="true" aria-label="Novo registro" data-testid="register-drawer"
              className="fixed bottom-0 right-0 top-0 z-[40] hidden w-[26rem] max-w-full flex-col border-l border-border bg-background shadow-2xl dashboard:flex"
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 330, damping: 34 }}>
              <div className="min-h-0 flex-1 overflow-hidden pb-24">
                <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Preparando o registro...</div>}>
                  <SmartRegister embedded desktop onClose={() => setOpen(false)} onController={setController} />
                </Suspense>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
      <div className="fixed bottom-4 right-4 z-[41] hidden dashboard:md:bottom-8 dashboard:md:right-6 dashboard:block">
        {dirty ? (
          <button type="button" onClick={() => setDiscardOpen(true)} aria-label="Descartar registro" data-testid="quick-action-discard"
            className="absolute -left-1.5 -top-1.5 z-10 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" onClick={onClick}
          className={cn("flex h-12 w-12 items-center justify-center rounded-full text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-95", dirty ? kindBg : "bg-primary")}
          aria-label={dirty ? "Salvar registro" : open ? "Fechar Registro Inteligente" : "Abrir Registro Inteligente"} data-testid="quick-action-fab">
          {dirty ? <Check className="h-6 w-6" aria-hidden="true" /> : open ? <X className="h-6 w-6" aria-hidden="true" /> : <Plus className="h-6 w-6" aria-hidden="true" />}
        </button>
      </div>
      <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title="Descartar este registro?" description="O que você preencheu será perdido." confirmLabel="Descartar e fechar" destructive onConfirm={() => setOpen(false)} />
    </>
  );
}
