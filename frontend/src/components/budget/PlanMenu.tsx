/**
 * Um lugar só para tudo o que se faz no Orçamento além de acompanhar o mês: um botão "Mais" que abre a lista agrupada
 * (este mês, planejar, fechar e histórico, ajustes). Substitui os atalhos soltos e o bloco Planejar do início.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarPlus, ChevronRight, ClipboardCheck, History, LineChart, ListChecks, MoreHorizontal, PieChart, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { addMonth, monthLabel } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Item = { to: string; title: string; sub: string; icon: typeof ListChecks; id: string };

export function planMenuGroups(month: string): { title: string; items: Item[] }[] {
  const prev = addMonth(month, -1), next = addMonth(month, 1);
  const name = (m: string) => monthLabel(m).split(" ")[0].toLowerCase();
  return [
    { title: "Este mês", items: [
      { id: "compromissos", to: `/orcamento/compromissos?mes=${month}`, title: "Compromissos", sub: "Contas, faturas, assinaturas e o que vai entrar", icon: ListChecks },
      { id: "gastos", to: `/orcamento/gastos?mes=${month}`, title: "Gastos do mês", sub: "Por categoria, com cada lançamento", icon: PieChart },
      { id: "ciclos", to: "/orcamento/ciclos", title: "Ciclo", sub: "O ciclo atual, o próximo e os fechados", icon: RefreshCw },
    ] },
    { title: "Planejar", items: [
      { id: "novo", to: `/orcamento/novo?mes=${next}`, title: "Começar um período", sub: `Regra, entradas, contas e limites de ${name(next)}`, icon: CalendarPlus },
      { id: "proximo", to: `/orcamento/proximo?mes=${next}`, title: "Próximo mês", sub: `Quanto ${name(next)} deixa para gastar`, icon: CalendarClock },
      { id: "projecao", to: `/orcamento/projecao?mes=${next}`, title: "Próximos meses", sub: "Projeção com os seus registros", icon: LineChart },
      { id: "especiais", to: "/orcamento/especiais", title: "Planos especiais", sub: "Viagens, festas e datas que pedem um plano", icon: Sparkles },
    ] },
    { title: "Fechar e histórico", items: [
      { id: "fechar", to: `/orcamento/fechar?mes=${prev}`, title: `Fechar ${name(prev)}`, sub: "Conferir o mês e decidir a sobra", icon: ClipboardCheck },
      { id: "historico", to: `/orcamento/historico?mes=${prev}`, title: "Histórico e análises", sub: "Fechamentos, retrospectiva e comparações", icon: History },
    ] },
    { title: "Ajustes", items: [
      { id: "configurar", to: "/orcamento/configuracoes", title: "Configurar o orçamento", sub: "Limites, regra, ciclo, avisos e reserva", icon: Settings2 },
    ] },
  ];
}

export function PlanMenuButton({ month, className }: { month: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => { setOpen(false); navigate(to); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-bold", className)} aria-haspopup="dialog" data-testid="budget-menu-button">
        <MoreHorizontal className="h-4 w-4" /> Mais
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88svh] gap-0 overflow-y-auto rounded-t-3xl p-0" data-testid="budget-menu">
          <div className="pb-1 pl-16 pr-5 pt-5"><SheetTitle className="font-heading text-xl leading-9">O que você quer fazer?</SheetTitle></div>
          <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
            {planMenuGroups(month).map((g) => (
              <section key={g.title}>
                <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.title}</p>
                <ul className="overflow-hidden rounded-2xl border border-border">
                  {g.items.map((i) => (
                    <li key={i.id}><button type="button" onClick={() => go(i.to)} className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-muted/40" data-testid={`budget-link-${i.id}`}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><i.icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><strong className="block text-sm">{i.title}</strong><span className="block truncate text-xs text-muted-foreground">{i.sub}</span></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button></li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

