import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** The receipt's pieces, shared by a saved lançamento and the invoice being paid. */
export function Card({ title, children, label }: { title: string; children: ReactNode; /** Read aloud instead of the rows, as one sentence. */ label?: string }) {
  return (
    <section className="shrink-0 rounded-[20px] border border-border/70 bg-card px-4 pb-2" aria-label={label}>
      <h3 className="pb-0.5 pt-2.5 text-xs font-semibold tracking-[1.5px] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** One line of the receipt: fades and rises as it scrolls into view, one after another. */
export function Row({ label, value, tone, i, last }: { label: string; value: ReactNode; tone?: string; i: number; last?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={"flex min-h-[38px] items-center justify-between gap-4 text-sm " + (last ? "" : "border-b border-dashed border-border")}
      initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ delay: (i % 6) * 0.07, duration: 0.32, ease: "easeOut" }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold" style={tone ? { color: tone } : undefined}>{value}</span>
    </motion.div>
  );
}

