import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding } from "@/lib/insights/invoices";

/** The frame every analysis of the library uses, so they look the same in Início, Cartões, Análise and Fluxo. */
export function InsightShell({ title, subtitle, icon, action, children, className, testId, to }: {
  title: string; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string;
  /** The analysis it comes from: the title opens it. */
  to?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-[24px] border border-border/70 bg-card p-4 sm:p-5", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {to ? (
            <Link to={to} className="inline-flex items-center gap-0.5 font-heading text-base font-semibold hover:text-primary">{title}<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>
          ) : <h2 className="font-heading text-base font-semibold">{title}</h2>}
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ?? (icon ? <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">{icon}</span> : null)}
      </div>
      <div className="mt-3">{children}</div>
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

/** "R$ 1.411,93" with smaller cents, like a receipt total. */
export function BigMoney({ value, hidden, className }: { value: number; hidden: boolean; className?: string }) {
  if (hidden) return <p className={cn("font-heading text-3xl font-bold", className)}>R$ ••••</p>;
  const [int, cents] = Math.abs(value).toFixed(2).split(".");
  return (
    <p className={cn("font-heading font-bold tabular-nums leading-none", className)}>
      <span className="mr-1 text-base text-muted-foreground">{value < 0 ? "−R$" : "R$"}</span>
      <span className="text-[34px]">{Number(int).toLocaleString("pt-BR")}</span>
      <span className="align-top text-base">,{cents}</span>
    </p>
  );
}

/** Pequeno and Médio widgets: a fixed-height tile, its label on top, the number and a short line. */
export function Tile({ title, icon, children, className, testId }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-border/70 bg-card p-4", className)} data-testid={testId}>
      <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-muted-foreground">{icon}{title}</p>
      <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
