import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDragToClose } from "@/lib/gestures/useDragToClose";

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (value: string) => { const [y, m, d] = value.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const shift = (value: string, days: number) => { const d = parse(value); d.setDate(d.getDate() + days); return iso(d); };

interface Props {
  open: boolean;
  value: string;
  onClose: () => void;
  onChange: (value: string) => void;
  /** Colour of the chosen day (the register's type colour). */
  accent?: string;
}

/** FINNOS's own calendar: quick days on top, the month below, in the app's colours. */
export function DatePickerSheet({ open, value, onClose, onChange, accent = "#7c3aed" }: Props) {
  const today = iso(new Date());
  const [month, setMonth] = useState(() => parse(value || today));
  useEffect(() => { if (open) setMonth(parse(value || today)); }, [open, value, today]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const title = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const pick = (v: string) => { onChange(v); onClose(); };
  const quick: [string, string][] = [["Hoje", today], ["Ontem", shift(today, -1)], ["Anteontem", shift(today, -2)]];

  const drag = useDragToClose(onClose, { whole: true });
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="date" className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 dashboard:items-center" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.div role="dialog" aria-modal="true" aria-label="Escolher data" data-testid="date-picker" onClick={(e) => e.stopPropagation()} {...drag.panel}
            className="w-full max-w-md rounded-t-[32px] border border-b-0 border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3.5 text-foreground dashboard:rounded-[28px] dashboard:border-b"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}>
            <div className="mx-auto mb-3 h-[5px] w-20 rounded-full bg-[#2a2b52]" aria-hidden="true" />
            <div className="flex h-11 items-center justify-between">
              <h2 className="text-[22px] font-bold">Data</h2>
              <span className="text-sm text-[#a78bfa]">{parse(value || today).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
            <div className="mt-2 flex gap-2">
              {quick.map(([label, v]) => (
                <button key={label} type="button" onClick={() => pick(v)} aria-pressed={value === v}
                  className={cn("h-9 rounded-full border px-4 text-sm", value === v ? "border-[#a78bfa] bg-primary/10 font-medium text-primary dark:bg-[#1d1640] dark:text-[#c4b5fd]" : "border-transparent bg-muted")}>{label}</button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button type="button" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-10 place-items-center rounded-full border border-border bg-background"><ChevronLeft size={18} /></button>
              <span className="text-base font-bold first-letter:uppercase" aria-live="polite">{title}</span>
              <button type="button" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-10 place-items-center rounded-full border border-border bg-background"><ChevronRight size={18} /></button>
            </div>
            <div className="mt-3 grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground">{WEEK.map((w, i) => <span key={i} className="py-1">{w}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-1" role="grid">
              {days.map((d) => {
                const v = iso(d); const inMonth = d.getMonth() === month.getMonth(); const chosen = v === value; const isToday = v === today;
                return (
                  <button key={v} type="button" onClick={() => pick(v)} aria-label={d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })} aria-pressed={chosen}
                    className={cn("mx-auto grid size-11 place-items-center rounded-full text-[15px] tabular-nums transition-colors", !inMonth && "text-muted-foreground/40", chosen ? "font-bold text-white" : isToday ? "border border-[#a78bfa] font-semibold text-[#c4b5fd]" : "hover:bg-muted")}
                    style={chosen ? { backgroundColor: accent } : undefined}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
