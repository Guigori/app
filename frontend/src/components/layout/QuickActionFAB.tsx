import { Suspense, useEffect, useState } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { AnimatePresence, motion } from "motion/react";
import { RegisterFab } from "@/components/layout/RegisterFab";
import { toast } from "sonner";
import { onRegisterSheet, type RegisterSheetRequest } from "@/lib/registerSheet";
import { DiscardRegisterDialog } from "@/components/layout/DiscardRegisterDialog";
import type { RegisterController } from "@/pages/SmartRegister";
const SmartRegister = lazyRetry(() => import("@/pages/SmartRegister"));

/** Desktop "+": opens the register in a drawer on the right (no on-screen keypad; the keyboard types the amount).
 *  On mobile the central button in the bottom bar owns it. Same ✕ / ✓ states and discard question as there. */
export function QuickActionFAB() {
  const [open, setOpenRaw] = useState(false);
  const [controller, setController] = useState<RegisterController | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Opened from elsewhere (a lançamento tapped in a list, "Registrar outro" after editing one).
  const [request, setRequest] = useState<RegisterSheetRequest>({});
  const [requestKey, setRequestKey] = useState(0);
  useEffect(() => onRegisterSheet((r) => { setRequest(r); setRequestKey((k) => k + 1); setOpenRaw(true); }, true), []);
  const setOpen = (next: boolean) => { setOpenRaw(next); if (!next) { setController(null); setDiscardOpen(false); } };
  const dirty = open && controller?.view !== "success" && controller?.dirty;
  const requestClose = () => { if (dirty) setDiscardOpen(true); else setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !dirty && !discardOpen) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dirty, discardOpen]);

  const onClick = () => {
    if (!open) { setRequest({}); setRequestKey((k) => k + 1); setOpen(true); return; }
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
                  <SmartRegister key={requestKey} existing={request.existing} siblings={request.siblings} template={request.template} initialKind={request.kind} embedded desktop onClose={() => setOpen(false)} onController={setController} />
                </Suspense>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
      <div className="fixed bottom-4 right-4 z-[41] hidden dashboard:md:bottom-8 dashboard:md:right-6 dashboard:block">
        <RegisterFab size="md" open={open} dirty={Boolean(dirty)} kind={controller?.kind ?? "Despesa"} success={open && controller?.view === "success"}
          testId="quick-action-fab" discardTestId="quick-action-discard" onMain={onClick} onDiscard={() => setDiscardOpen(true)} />
      </div>
      <DiscardRegisterDialog open={discardOpen} kind={controller?.kind ?? "Despesa"} onKeep={() => setDiscardOpen(false)} onDiscard={() => setOpen(false)} />
    </>
  );
}
