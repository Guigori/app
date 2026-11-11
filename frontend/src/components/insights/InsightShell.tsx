import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { Finding } from "@/lib/insights/invoices";

/** Shared type scale of the library, the same as Saldo total and Radar (no squeezed or cut numbers: they follow the card width). */
export const LABEL = "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
export const NUMBER = "font-heading font-bold tracking-tight tabular-nums whitespace-nowrap leading-none";
export const NUMBER_TILE = `${NUMBER} text-[clamp(1.2rem,12cqw,2rem)]`;
export const NUMBER_HERO = `${NUMBER} text-[clamp(1.75rem,9cqw,2.5rem)]`;
export const NOTE = "text-[13px] leading-snug text-muted-foreground";

/** The frame of Grande widgets and of the analysis page, like the Radar card. */
export function InsightShell({ title, subtitle, action, children, className, testId, to }: {
  title: string; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string;
  /** The analysis page: the title opens it. */
  to?: string;
}) {
  return (
    <section className={cn("@container flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border/80 bg-card p-5 shadow-sm", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {to ? (
            <Link to={to} className="inline-flex items-center gap-0.5 font-heading text-lg font-semibold tracking-tight hover:text-primary">{title}<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>
          ) : <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>}
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** One line of reading, with a tone: good news, attention, or just information. */
export function FindingList({ findings, testId }: { findings: Finding[]; testId?: string }) {
  if (!findings.length) return null;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {findings.map((f) => {
        const Icon = f.tone === "bad" ? AlertTriangle : f.tone === "good" ? CheckCircle2 : Info;
        return (
          <li key={f.text} className="flex items-start gap-2 text-sm">
            <Icon className={cn("mt-0.5 size-4 shrink-0", f.tone === "bad" ? "text-expense" : f.tone === "good" ? "text-income" : "text-primary")} aria-hidden="true" />
            <span className="min-w-0">{f.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The main amount of a Grande widget: one size, never split or cut. */
export function BigMoney({ value, hidden, className }: { value: number; hidden: boolean; className?: string }) {
  return <p className={cn(NUMBER_HERO, className)}>{hidden ? "R$ ••••" : formatBRL(value)}</p>;
}

/** Pequeno and Médio widgets: a fixed-height card, its label on top, the number and a short line. */
export function Tile({ title, children, className, testId }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("@container flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border/80 bg-card p-4 shadow-sm", className)} data-testid={testId}>
      <p className={cn(LABEL, "truncate")}>{title}</p>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
