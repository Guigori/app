import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RegisterKind = "Despesa" | "Receita" | "Transferência";

/** One look per type, shared by the register, its floating button and this screen. */
export const KIND_THEME: Record<RegisterKind, { icon: typeof ArrowUpRight; soft: string; text: string; solid: string; ring: string; amount: string; title: string }> = {
  Despesa: { icon: ArrowUpRight, soft: "bg-expense/12", text: "text-expense", solid: "bg-expense text-white", ring: "stroke-expense", amount: "text-expense", title: "Despesa salva" },
  Receita: { icon: ArrowDownLeft, soft: "bg-income/12", text: "text-income", solid: "bg-income text-white", ring: "stroke-income", amount: "text-income", title: "Receita salva" },
  "Transferência": { icon: ArrowLeftRight, soft: "bg-primary/12", text: "text-primary", solid: "bg-primary text-primary-foreground", ring: "stroke-primary", amount: "text-primary", title: "Transferência feita" },
};

const KINDS: RegisterKind[] = ["Despesa", "Receita", "Transferência"];
const AUTO_CLOSE_MS = 6000;

export interface RegisterSuccessProps {
  kind: RegisterKind;
  amount: string;
  name: string;
  chips: string[];
  pending?: boolean;
  /** Starts a new entry; the type is chosen here, never repeated from the last one. */
  onAnother: (kind: RegisterKind) => void;
  onView: () => void;
  onDone: () => void;
}

/** Saved: the check draws itself, the facts appear, and the next step is one tap away. */
export function RegisterSuccess({ kind, amount, name, chips, pending = false, onAnother, onView, onDone }: RegisterSuccessProps) {
  const theme = KIND_THEME[kind];
  const reduce = useReducedMotion();
  useEffect(() => {
    const timer = window.setTimeout(onDone, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  const rise = (delay: number) => reduce ? {} : ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.32, ease: "easeOut" } } as const);

  return (
    <div role="status" aria-live="polite" className="relative flex h-full min-h-0 w-full flex-col items-center overflow-hidden bg-background px-5 pb-6 pt-10 text-foreground" data-testid="register-success">
      <span className="sr-only">{pending ? "Salvo no aparelho. Sincronização pendente." : "Salvo"}</span>
      <div className="relative mt-[clamp(1.5rem,9dvh,5.5rem)] size-[140px] shrink-0">
        {reduce ? null : [0, 0.2].map((delay) => (
          <motion.span key={delay} aria-hidden="true" className={cn("absolute inset-0 rounded-full border-2", kind === "Despesa" ? "border-expense" : kind === "Receita" ? "border-income" : "border-primary")}
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1.9, opacity: [0, 0.7, 0] }} transition={{ delay: 0.45 + delay, duration: 1.2, ease: "easeOut" }} />
        ))}
        <motion.span aria-hidden="true" className={cn("absolute inset-[18px] rounded-full", theme.solid)}
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.1 }} />
        <svg viewBox="0 0 140 140" className="absolute inset-0" fill="none" aria-hidden="true">
          <motion.circle cx="70" cy="70" r="62" strokeWidth="3" strokeLinecap="round" className={theme.ring} transform="rotate(-90 70 70)"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} />
          <motion.path d="M48 72 L64 88 L94 54" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.35, ease: "easeOut" }} />
        </svg>
      </div>

      <motion.p className="mt-8 text-2xl font-bold" {...rise(0.5)}>{theme.title}</motion.p>
      <motion.p className={cn("mt-1.5 font-heading text-5xl font-bold leading-tight tracking-tight tabular-nums", theme.amount)} {...rise(0.6)}>{amount}</motion.p>

      <motion.div className="mt-7 w-full rounded-3xl border border-border bg-card p-4" {...rise(0.7)}>
        <p className="truncate text-[1.0625rem] font-bold">{name}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => <li key={chip} className="rounded-full bg-muted px-3 py-1 text-sm">{chip}</li>)}
        </ul>
      </motion.div>

      <motion.div className="mt-auto flex w-full flex-col items-center gap-3" {...rise(0.8)}>
        <div className="w-full space-y-2">
          <p className="text-center text-[0.8125rem] text-muted-foreground">Registrar outro</p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Registrar outro">
            {KINDS.map((k) => {
              const t = KIND_THEME[k];
              return (
                <button key={k} type="button" onClick={() => onAnother(k)} data-testid={`register-another-${k}`}
                  className={cn("flex h-[3.75rem] flex-col items-center justify-center gap-1 rounded-[1.375rem] text-xs font-bold transition-transform active:scale-95", t.soft, t.text)}>
                  <t.icon size={20} aria-hidden="true" />{k}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={onView} data-testid="register-view" className="h-12 w-full rounded-full border border-border bg-card text-[0.9375rem] font-bold transition-transform active:scale-[.98]">Ver lançamento</button>
        <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-border" aria-hidden="true">
          <motion.div className={cn("h-full origin-left", kind === "Despesa" ? "bg-expense" : kind === "Receita" ? "bg-income" : "bg-primary")} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: AUTO_CLOSE_MS / 1000, ease: "linear" }} />
        </div>
        <p className="text-xs text-muted-foreground">Fecha sozinho</p>
      </motion.div>
    </div>
  );
}
