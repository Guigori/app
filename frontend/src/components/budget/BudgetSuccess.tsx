/**
 * Concluído (fechar o mês, começar o período): a mesma animação do registro salvo — o ✓ se desenha, os anéis se
 * abrem e os fatos aparecem — e depois volta ao Orçamento.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";

const ACC = "#c4b5fd", DISC = "#7c3aed";
const AUTO_MS = 4200;

export function BudgetSuccess({ title, amount, amountLabel, chips, action, onDone }: { title: string; amount: string; amountLabel?: string; chips: string[]; action: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => { const t = window.setTimeout(() => done.current(), AUTO_MS + (reduce ? 0 : 1200)); return () => window.clearTimeout(t); }, [reduce]);
  const rise = (delay: number) => (reduce ? {} : ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.9 + delay, duration: 0.36, ease: "easeOut" } } as const));
  return createPortal(
    <div role="status" aria-live="polite" className="fixed inset-0 z-[80] flex flex-col items-center overflow-y-auto bg-background px-5 pb-10 pt-[12dvh] text-foreground" data-testid="budget-success">
      <div className="relative size-[140px] shrink-0">
        {reduce ? null : [0, 0.2].map((delay) => (
          <motion.span key={delay} aria-hidden="true" className="absolute inset-0 rounded-full border-2" style={{ borderColor: ACC }}
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: [0.7, 0.75, 1.9], opacity: [0, 0.7, 0] }} transition={{ delay: 0.5 + delay, duration: 1.6, times: [0, 0.08, 1], ease: "easeOut" }} />
        ))}
        {reduce ? null : Array.from({ length: 10 }, (_, i) => {
          const far = i % 2 === 1, size = far ? 6 : 8, d = far ? 112 : 92;
          return <motion.span key={i} aria-hidden="true" className="absolute left-1/2 top-1/2 rounded-full" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, background: i % 3 === 0 ? "#fff" : ACC, rotate: i * 36 }}
            initial={{ y: -30, scale: 0.4, opacity: 0 }} animate={{ y: -d, scale: 1, opacity: [0, 1, 0] }} transition={{ delay: 0.6, duration: 1.45, times: [0, 0.15, 1], ease: "easeOut" }} />;
        })}
        <svg viewBox="0 0 140 140" className="absolute inset-0" fill="none" role="img" aria-label="Concluído">
          <motion.circle cx="70" cy="70" r="52" fill={DISC} style={{ transformBox: "fill-box", transformOrigin: "center" }} initial={reduce ? false : { scale: 0 }} animate={{ scale: [0, 1.12, 1] }} transition={{ delay: 0.3, duration: 0.6, times: [0, 0.6, 1], ease: [0.2, 0.9, 0.3, 1.2] }} />
          <motion.circle cx="70" cy="70" r="62" strokeWidth="3" strokeLinecap="round" stroke={ACC} transform="rotate(-90 70 70)" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }} />
          <motion.path d="M48 72 L64 88 L94 54" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.7, ease: "easeOut" }} />
        </svg>
      </div>
      <motion.p className="mt-8 text-center text-2xl font-bold" {...rise(0)}>{title}</motion.p>
      {amountLabel ? <motion.p className="mt-2 text-sm text-muted-foreground" {...rise(0.1)}>{amountLabel}</motion.p> : null}
      <motion.p className="mt-1 text-[44px] font-bold leading-[1.1] tracking-[-1px] tabular-nums text-primary" {...rise(0.2)}>{amount}</motion.p>
      {chips.length ? (
        <motion.ul className="mt-6 flex max-w-md flex-wrap justify-center gap-2" {...rise(0.4)}>
          {chips.map((c) => <li key={c} className="flex h-[30px] items-center rounded-full bg-muted px-3 text-sm">{c}</li>)}
        </motion.ul>
      ) : null}
      <motion.button type="button" onClick={() => done.current()} className="mt-10 h-14 w-full max-w-md rounded-full bg-primary text-base font-bold text-primary-foreground" {...rise(0.6)} data-testid="budget-success-go">{action}</motion.button>
    </div>,
    document.body,
  );
}
