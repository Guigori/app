import { useEffect, useRef, useState } from "react";
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
const AUTO_CLOSE_MS = 7000;
/** The ✓ grows from the floating button over the whole screen first; the content shows once it has. */
const D = 1.3;

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

/** Colours of the prototype's success screens. */
const PROTO: Record<RegisterKind, { acc: string; disc: string; soft: string }> = {
  Despesa: { acc: "#fb7185", disc: "#e11d48", soft: "bg-expense/12 text-expense dark:bg-[#3a1020] dark:text-[#ff6b88]" },
  Receita: { acc: "#34d399", disc: "#047857", soft: "bg-income/12 text-income dark:bg-[#0d2a22] dark:text-[#34d399]" },
  "Transferência": { acc: "#c4b5fd", disc: "#7c3aed", soft: "bg-primary/12 text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]" },
};

/** Saved: the check draws itself, the facts appear, and the next step is one tap away. */
export function RegisterSuccess({ kind, amount, name, chips, pending = false, onAnother, onView, onDone }: RegisterSuccessProps) {
  const theme = KIND_THEME[kind];
  const reduce = useReducedMotion();
  const [closing, setClosing] = useState(false);
  // The screen colour, resolved once so the grown circle can fade into it.
  const [bg] = useState(() => {
    if (typeof document === "undefined") return "#000000";
    const probe = document.createElement("span"); probe.style.color = "var(--background)"; document.body.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove(); return c || "#000000";
  });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // Closing plays the grow backwards: content fades, the circle shrinks into the + (purple) again.
  const close = (then: () => void) => { if (closing) return; if (reduce) { then(); return; } setClosing(true); window.setTimeout(then, 700); };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current(() => doneRef.current()), (reduce ? 0 : (D + 1.7) * 1000) + AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [reduce]);

  const rise = (delay: number) => reduce ? {} : ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: D + delay, duration: 0.36, ease: "easeOut" } } as const);

  const tone = PROTO[kind];
  return (
    <div role="status" aria-live="polite" className="relative h-full min-h-0 w-full text-foreground" data-testid="register-success">
      {/* The ✓ of the floating button grows over the screen in the type's colour, then turns into the background. */}
      {reduce ? null : <motion.span aria-hidden="true" className="pointer-events-none fixed bottom-[calc(1.27rem+env(safe-area-inset-bottom))] right-[0.8rem] z-0 size-[4.15rem] rounded-full dashboard:bottom-8 dashboard:right-6 dashboard:size-12"
        initial={{ scale: 1, backgroundColor: tone.disc }}
        animate={closing ? { scale: 1, backgroundColor: "#8b5cf6", opacity: [1, 1, 0] } : { scale: [1, 30, 30], backgroundColor: [tone.disc, tone.disc, bg] }}
        transition={closing ? { duration: 0.65, ease: [0.5, 0, 0.2, 1], opacity: { duration: 0.7, times: [0, 0.9, 1] } } : { duration: 1.6, times: [0, 0.75, 1], ease: [0.5, 0, 0.2, 1] }} />}
      <motion.div className={cn("relative z-[1] flex h-full min-h-0 w-full flex-col items-center overflow-y-auto px-5 pb-8 pt-7", reduce && "bg-background")}
        initial={false} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: 0.2 }}>
      <span className="sr-only">{pending ? "Salvo no aparelho. Sincronização pendente." : "Salvo"}</span>
      <div className="relative mt-[clamp(1rem,15dvh,8.25rem)] size-[140px] shrink-0">
        {reduce ? null : [0, 0.2].map((delay) => (
          <motion.span key={delay} aria-hidden="true" className="absolute inset-0 rounded-full border-2" style={{ borderColor: tone.acc }}
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: [0.7, 0.75, 1.9], opacity: [0, 0.7, 0] }} transition={{ delay: D + 0.2 + delay, duration: 1.6, times: [0, 0.08, 1], ease: "easeOut" }} />
        ))}
        {reduce ? null : Array.from({ length: 10 }, (_, i) => {
          const far = i % 2 === 1; const white = i % 3 === 0; const size = far ? 6 : 8; const d = far ? 112 : 92;
          return (
            <motion.span key={i} aria-hidden="true" className="absolute left-1/2 top-1/2 rounded-full"
              style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, background: white ? "#fff" : tone.acc, rotate: i * 36 }}
              initial={{ y: -30, scale: 0.4, opacity: 0 }} animate={{ y: -d, scale: 1, opacity: [0, 1, 0] }} transition={{ delay: D + 0.3, duration: 1.45, times: [0, 0.15, 1], ease: "easeOut" }} />
          );
        })}
        <svg viewBox="0 0 140 140" className="absolute inset-0" fill="none" role="img" aria-label="Registro concluído">
          <motion.circle cx="70" cy="70" r="52" fill={tone.disc} style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={reduce ? false : { scale: 0 }} animate={{ scale: [0, 1.12, 1] }} transition={{ delay: D + 0.1, duration: 0.6, times: [0, 0.6, 1], ease: [0.2, 0.9, 0.3, 1.2] }} />
          <motion.circle cx="70" cy="70" r="62" strokeWidth="3" strokeLinecap="round" stroke={tone.acc} transform="rotate(-90 70 70)"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: D, duration: 0.6, ease: "easeOut" }} />
          <motion.path d="M48 72 L64 88 L94 54" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: D + 0.5, ease: "easeOut" }} />
        </svg>
      </div>

      <motion.p className="mt-8 text-2xl font-bold" {...rise(0.7)}>{theme.title}</motion.p>
      <motion.p className="mt-1.5 text-[48px] font-bold leading-[1.1] tracking-[-1px] tabular-nums" style={{ color: tone.acc }} {...rise(0.9)}>{amount}</motion.p>

      <motion.div className="mt-7 flex w-full flex-col gap-3 rounded-3xl border border-border bg-card p-4" {...rise(1.1)}>
        <p className="truncate text-[17px] font-bold">{name}</p>
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip, i) => <li key={chip} className={cn("flex h-[30px] items-center rounded-full px-3 text-sm", i === chips.length - 1 ? "bg-primary/10 font-medium text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]" : "bg-muted")}>{chip}</li>)}
        </ul>
      </motion.div>

      <motion.div className="mt-auto flex w-full flex-col items-center gap-3 pt-6" {...rise(1.3)}>
        <div className="flex w-full flex-col gap-2">
          <p className="text-center text-[13px] text-muted-foreground">Registrar outro</p>
          <div className="flex gap-2" role="group" aria-label="Registrar outro">
            {KINDS.map((k) => {
              const t = KIND_THEME[k];
              return (
                <button key={k} type="button" onClick={() => onAnother(k)} data-testid={`register-another-${k}`}
                  className={cn("flex h-[60px] flex-1 flex-col items-center justify-center gap-1 rounded-[22px] text-xs font-bold transition-transform active:scale-95", PROTO[k].soft)}>
                  <t.icon size={20} aria-hidden="true" />{k}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={() => close(onView)} data-testid="register-view" className="h-12 w-full rounded-full border border-border bg-card text-[15px] font-bold transition-transform active:scale-[.98]">Ver lançamento</button>
        <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-border" aria-hidden="true">
          <motion.div className="h-full origin-left" style={{ background: tone.acc }} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ delay: reduce ? 0 : D + 1.7, duration: AUTO_CLOSE_MS / 1000, ease: "linear" }} />
        </div>
        <p className="text-xs text-muted-foreground">Fecha sozinho</p>
      </motion.div>
      </motion.div>
    </div>
  );
}
