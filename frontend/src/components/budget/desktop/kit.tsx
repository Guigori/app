/**
 * Orçamento no computador: peças próprias da tela larga (não o layout do celular esticado).
 * Segue o Dashboard web do FINNOS: cabeçalho enxuto com botões de ícone, uma faixa de números com divisórias,
 * tabelas densas e controles de tamanho fixo. Nenhum botão ocupa a largura toda.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Settings2 } from "lucide-react";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { cn } from "@/lib/utils";

const DESKTOP_QUERY = "(min-width: 1024px)";

/** Same switch as the Início (DashboardEntry): the wide layout from 1024px. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

const AREAS = [
  { to: "/orcamento", label: "Visão geral" },
  { to: "/orcamento/gastos", label: "Gastos do mês" },
  { to: "/orcamento/proximo", label: "Planejar o próximo mês" },
  { to: "/orcamento/projecao", label: "Projeção" },
  { to: "/orcamento/fechar", label: "Fechar o mês" },
  { to: "/orcamento/historico", label: "Histórico" },
] as const;

export function DeskPage({ children, testId }: { children: ReactNode; testId: string }) {
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-10 animate-fade-up min-[1800px]:max-w-[1680px]" data-testid={testId}>{children}</div>;
}

export function DeskHeader({ title, month = currentMonth(), setMonth, actions, subtitle }: { title: string; month?: string; setMonth?: (m: string) => void; actions?: ReactNode; subtitle?: ReactNode }) {
  const { hidden, toggle } = useBalanceHidden();
  const location = useLocation();
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0"><h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>{subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}</div>
        <div className="flex items-center gap-1">
          {actions}
          <button type="button" onClick={toggle} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} aria-pressed={hidden} title={hidden ? "Mostrar valores" : "Ocultar valores"} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 hover:bg-muted hover:text-foreground">{hidden ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <Link to="/orcamento/configuracoes" aria-label="Configurar orçamento" title="Configurar orçamento" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/75 hover:bg-muted hover:text-foreground" data-testid="budget-settings-button"><Settings2 size={18} /></Link>
          {setMonth ? <>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <button type="button" aria-label="Mês anterior" onClick={() => setMonth(addMonth(month, -1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft size={18} /></button>
            <span className="min-w-36 text-center text-sm font-medium" data-testid="budget-month">{monthLabel(month)}</span>
            <button type="button" aria-label="Próximo mês" onClick={() => setMonth(addMonth(month, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"><ChevronRight size={18} /></button>
            {month !== currentMonth() && ["/orcamento", "/orcamento/gastos"].includes(location.pathname) ? <button type="button" onClick={() => setMonth(currentMonth())} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted">Hoje</button> : null}
          </> : null}
        </div>
      </header>
      <nav aria-label="Áreas do orçamento" className="mt-3 flex gap-7 border-b border-border">
        {AREAS.map((a) => {
          const on = location.pathname === a.to;
          // Each area opens on the month it is about: planning and projection look ahead, closing looks back.
          const q = on ? month : a.to === "/orcamento/proximo" || a.to === "/orcamento/projecao" ? addMonth(currentMonth(), 1) : a.to === "/orcamento/fechar" || a.to === "/orcamento/historico" ? addMonth(currentMonth(), -1) : currentMonth();
          return <Link key={a.to} to={`${a.to}?mes=${q}`} aria-current={on ? "page" : undefined} className={cn("-mb-px border-b-2 pb-2.5 text-sm font-medium", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{a.label}</Link>;
        })}
      </nav>
    </div>
  );
}

/** Faixa de números: um cartão só, com divisórias, em vez de vários cartões grandes. */
export function KpiStrip({ items, aside }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: "income" | "expense" | "primary"; testId?: string }[]; aside?: ReactNode }) {
  return (
    <section className="flex items-stretch overflow-hidden rounded-2xl border border-border bg-card" aria-label="Resumo">
      <dl className="grid flex-1 divide-x divide-border" style={{ gridTemplateColumns: `minmax(0, 1.5fr) repeat(${items.length - 1}, minmax(0, 1fr))` }}>
        {items.map((k, i) => (
          <div key={k.label} className={cn("min-w-0 px-5 py-4", i === 0 && "bg-primary/[0.04]")} data-testid={k.testId}>
            <dt className="truncate text-xs font-medium text-muted-foreground">{k.label}</dt>
            <dd className={cn("mt-1 truncate font-heading font-semibold tabular-nums", i === 0 ? "text-[26px] leading-tight" : "text-lg", k.tone === "income" && "text-income", k.tone === "expense" && "text-expense", k.tone === "primary" && "text-primary")}>{k.value}</dd>
            {k.hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{k.hint}</p> : null}
          </div>
        ))}
      </dl>
      {aside ? <div className="flex shrink-0 items-center gap-2 border-l border-border px-5">{aside}</div> : null}
    </section>
  );
}

export function Panel({ title, action, children, className, testId, flush = false }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string; flush?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card", !flush && "p-5", className)} data-testid={testId}>
      {title || action ? <div className={cn("flex items-center justify-between gap-3", flush ? "px-5 pt-4" : "", "mb-3")}><h2 className="font-heading text-[15px] font-semibold">{title}</h2>{action}</div> : null}
      {children}
    </section>
  );
}

/** Small segmented control with its natural width. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-muted p-0.5">
      {options.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={cn("h-7 rounded-full px-3 text-xs font-medium", value === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
export const td = "px-3 py-2.5 text-sm";
