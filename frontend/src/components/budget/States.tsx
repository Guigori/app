/**
 * Orçamento · tela 13 (estados): carregando, sem conexão, sem orçamento. Usados no início, no celular e no computador.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { PieChart, WifiOff } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BudgetLoading({ desktop = false }: { desktop?: boolean }) {
  const bar = "rounded-xl bg-muted animate-pulse";
  return (
    <div aria-busy="true" aria-label="Carregando o orçamento" className="grid gap-3" data-testid="budget-loading">
      {desktop ? <div className={cn(bar, "h-24")} /> : <><div className={cn(bar, "h-4 w-2/5")} /><div className={cn(bar, "h-12 w-3/4")} /></>}
      <div className={cn("grid gap-3", desktop ? "grid-cols-3" : "grid-cols-1")}><div className={cn(bar, "h-40")} />{desktop ? <><div className={cn(bar, "h-40")} /><div className={cn(bar, "h-40")} /></> : null}</div>
      <div className="grid grid-cols-3 gap-2"><div className={cn(bar, "h-16")} /><div className={cn(bar, "h-16")} /><div className={cn(bar, "h-16")} /></div>
      <p className="text-[13px] text-muted-foreground">Buscando saldos na Carteira, contas no Fluxo e metas em Metas…</p>
    </div>
  );
}

/** Nothing came back and there is no copy on this device yet. */
export function BudgetFailed({ onRetry }: { onRetry: () => void }) {
  const [tried, setTried] = useState(false);
  return (
    <section role="alert" className="rounded-[20px] bg-expense/10 p-5 text-expense" data-testid="budget-failed">
      <h2 className="font-heading text-lg font-bold">Não deu para atualizar agora</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">A Carteira e o Fluxo não responderam e ainda não há uma cópia guardada neste aparelho. Confira a internet e tente de novo.</p>
      <Button type="button" onClick={() => { setTried(true); onRetry(); }} className="mt-3 rounded-full bg-expense text-white hover:bg-expense/90">{tried ? "Tentar de novo outra vez" : "Tentar de novo"}</Button>
    </section>
  );
}

/** Offline but with the device copy: everything works, the numbers may be behind. */
export function OfflineNote() {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground" data-testid="budget-offline">
      <WifiOff className="h-4 w-4 shrink-0" /> Sem internet: valores da cópia guardada neste aparelho. O livre pode estar desatualizado.
    </p>
  );
}

export function NoBudgetCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={cn("flex gap-4 rounded-[20px] border border-primary/30 bg-primary/[0.05] p-5", compact ? "flex-col text-center" : "items-center")} data-testid="budget-empty">
      <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary", compact && "mx-auto")}><PieChart className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-lg font-bold">Você ainda não tem orçamento</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">O FINNOS monta um ponto de partida com o que já está no Fluxo. Você só confirma os limites. O livre para gastar já funciona sem eles.</p>
      </div>
      <Link to="/orcamento/comecar" className={cn(buttonVariants(), "shrink-0 rounded-full")} data-testid="budget-empty-start">Montar meu orçamento</Link>
    </section>
  );
}
