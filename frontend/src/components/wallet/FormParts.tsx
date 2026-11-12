import { cn } from "@/lib/utils";

/** On/off switch of the Carteira settings screens (prototype). */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-[3px] size-[26px] rounded-full bg-card shadow transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}

/** − value + control (days, amounts). */
export function Stepper({ value, onMinus, onPlus, minusLabel, plusLabel, className }: { value: React.ReactNode; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <button type="button" onClick={onMinus} aria-label={minusLabel} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">−</button>
      <strong className="min-w-16 text-center font-heading text-[15px] tabular-nums">{value}</strong>
      <button type="button" onClick={onPlus} aria-label={plusLabel} className="grid size-9 place-items-center rounded-full border border-border bg-card text-lg">+</button>
    </span>
  );
}
