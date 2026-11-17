/** O próximo passo do ritual do mês (fechar o anterior, planejar o próximo), no topo do Orçamento. */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarPlus, ClipboardCheck, X } from "lucide-react";
import { useState } from "react";
import { fetchTrends } from "@/lib/data";
import { addMonth, currentMonth, monthLabel, todayISO } from "@/lib/format";
import { nextStep } from "@/lib/budget/nextStep";
import { useBudgetSettings } from "@/lib/budget/prefs";
import { useBudgetClosings, useBudgetPlans } from "@/components/budget/usePlans";
import { cn } from "@/lib/utils";

export function NextStepCard({ className }: { className?: string }) {
  const today = todayISO();
  const [settings] = useBudgetSettings();
  const closings = useBudgetClosings();
  const plans = useBudgetPlans();
  const trends = useQuery({ queryKey: ["trends", 3, addMonth(currentMonth(), -1)], queryFn: () => fetchTrends(3, addMonth(currentMonth(), -1)) });
  const [hidden, setHidden] = useState<string | null>(() => { try { return sessionStorage.getItem("finnos:budget-next-step-hidden"); } catch { return null; } });
  if (closings.loading || plans.loading || !trends.data) return null;
  const step = nextStep({
    today, on: { fechar: settings.alerts.fechar !== false, planejar: settings.alerts.planejar !== false },
    closed: (m) => Boolean(closings.closingOf(m)),
    planned: (m) => Boolean(plans.planOf(m).updated_at) || plans.planOf(m).approved.length > 0 || plans.planOf(m).planned_income > 0,
    hadMovement: (m) => (trends.data?.months ?? []).some((t) => t.month === m && (t.income > 0 || t.expense > 0)),
  });
  if (!step || hidden === `${step.kind}:${step.month}`) return null;
  const name = monthLabel(step.month).split(" ")[0].toLowerCase();
  const Icon = step.kind === "fechar" ? ClipboardCheck : CalendarPlus;
  const prevName = monthLabel(addMonth(step.month, -1)).split(" ")[0].toLowerCase();
  const hide = () => { const k = `${step.kind}:${step.month}`; setHidden(k); try { sessionStorage.setItem("finnos:budget-next-step-hidden", k); } catch { /* ignore */ } };
  return (
    <section className={cn("relative flex flex-wrap items-center gap-3 rounded-[20px] border border-primary/25 bg-primary/[0.05] p-4 pr-11 sm:flex-nowrap", className)} data-testid="budget-next-step">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 basis-[60%]">
        <p className="text-xs font-semibold text-primary">Próximo passo</p>
        <p className="text-sm font-semibold">{step.kind === "fechar" ? `Fechar ${name}` : step.kind === "comecar" ? `Começar ${name}` : `Planejar ${name}`}</p>
        <p className="text-xs text-muted-foreground">{step.kind === "fechar" ? "Confira o que aconteceu, decida o que fazer com a sobra e guarde o retrato do mês." : step.kind === "comecar" ? `${prevName.charAt(0).toUpperCase() + prevName.slice(1)} está fechado. Escolha a regra, o que entra e o que sai em ${name}.` : "Escolha o que entra, o que sai e quanto guardar antes de o mês começar."}</p>
      </div>
      <Link to={step.to} className="ml-[3.25rem] inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground sm:ml-0">{step.kind === "fechar" ? "Fechar" : step.kind === "comecar" ? "Começar" : "Planejar"} <ArrowRight className="h-3.5 w-3.5" /></Link>
      <button type="button" onClick={hide} aria-label="Esconder por agora" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
    </section>
  );
}
