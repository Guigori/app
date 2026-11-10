import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "Despesa" | "Receita" | "Transferência";

const KIND_BG: Record<Kind, string> = {
  Despesa: "bg-[#e11d48] shadow-[0_0_0_5px_rgba(225,29,72,.28),0_8px_24px_rgba(225,29,72,.28)]",
  Receita: "bg-[#047857] shadow-[0_0_0_5px_rgba(4,120,87,.38),0_8px_24px_rgba(4,120,87,.38)]",
  Transferência: "bg-[#7c3aed] shadow-[0_0_0_5px_rgba(124,58,237,.34),0_8px_24px_rgba(124,58,237,.34)]",
};

interface Props {
  open: boolean;
  dirty: boolean;
  kind: Kind;
  /** The success screen is showing: the ✓ grows over the screen and the button steps aside. */
  success: boolean;
  size?: "lg" | "md";
  onMain: () => void;
  onDiscard: () => void;
  testId: string;
  discardTestId: string;
}

/**
 * The register's floating button, as in the prototype: + turns (45°) into ✕ while the register opens,
 * turns into a ✓ in the type's colour once something is typed (a small ✕ slides out to its left to close
 * without saving), and on save the ✓ grows over the screen before the success screen shows.
 */
export function RegisterFab({ open, dirty, kind, success, size = "lg", onMain, onDiscard, testId, discardTestId }: Props) {
  const reduce = useReducedMotion();
  const big = size === "lg";
  const check = open && dirty && !success;
  const spring = { type: "spring" as const, stiffness: 420, damping: 30 };
  return (
    <div className={cn("relative shrink-0", big ? "size-[4.15rem]" : "size-12")}>
      <AnimatePresence>
        {check ? (
          <motion.button key="discard" type="button" onClick={onDiscard} aria-label="Descartar registro" data-testid={discardTestId}
            className={cn("absolute top-1/2 -mt-6 grid place-items-center rounded-full border border-[#2f3060] bg-muted text-foreground", big ? "right-[calc(100%+0.75rem)] size-12" : "right-[calc(100%+0.6rem)] size-12")}
            initial={reduce ? { opacity: 0 } : { x: 68, scale: 0.3, opacity: 0 }} animate={{ x: 0, scale: 1, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: 68, scale: 0.3, opacity: 0 }} transition={spring}>
            <X className={big ? "size-5" : "size-4"} aria-hidden="true" />
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* On save the ✓ grows to cover the screen, then fades into the success screen. */}
      <AnimatePresence>
        {success && !reduce ? (
          <motion.span key="grow" aria-hidden="true" className={cn("pointer-events-none absolute inset-0 z-10 rounded-full", KIND_BG[kind])}
            initial={{ scale: 1, opacity: 1 }} animate={{ scale: [1, 30, 30], opacity: [1, 1, 0] }} transition={{ duration: 0.95, times: [0, 0.5, 1], ease: [0.22, 1, 0.36, 1] }} />
        ) : null}
      </AnimatePresence>

      <motion.button type="button" onClick={onMain} data-testid={testId} aria-expanded={open}
        aria-label={check ? "Salvar registro" : open ? "Fechar Registro Inteligente" : "Abrir Registro Inteligente"}
        whileTap={{ scale: 0.88 }} animate={{ opacity: success ? 0 : 1, scale: success ? 0.6 : 1 }} transition={spring}
        className={cn("relative grid size-full place-items-center rounded-full text-white transition-[background-color,box-shadow] duration-300",
          check ? KIND_BG[kind] : "bg-[#8b5cf6] shadow-[0_8px_24px_rgba(139,92,246,.35)]", success && "pointer-events-none")}>
        {/* One + that turns into ✕ (45°); the ✓ takes its place when there is something to save. */}
        <motion.span className="absolute grid place-items-center" initial={false}
          animate={{ rotate: check ? 90 : open ? 45 : 0, opacity: check ? 0 : 1 }} transition={spring}>
          <Plus className={big ? "size-8" : "size-6"} aria-hidden="true" />
        </motion.span>
        <motion.span className="absolute grid place-items-center" initial={false}
          animate={{ scale: check ? 1 : 0.4, opacity: check ? 1 : 0 }} transition={spring}>
          <Check className={big ? "size-8" : "size-6"} aria-hidden="true" />
        </motion.span>
      </motion.button>
    </div>
  );
}
