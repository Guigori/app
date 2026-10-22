import { Link, Navigate } from "react-router-dom";
import { useExperienceMode } from "@/lib/experienceMode";
import { ArrowUpRight } from "lucide-react";

/** Layout foundation only. Live KPIs are intentionally deferred until the shared finance hooks are audited. */
export default function DashboardOverview() {
  const mode = useExperienceMode();
  if (mode === "app") return <Navigate to="/" replace />;
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-[.12em] text-neutral-500">Visão geral</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Seu painel financeiro</h1><p className="mt-2 text-sm text-neutral-500">Uma visão organizada das suas finanças.</p></div>
        <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm dark:border-white/10 dark:bg-[#202127]">Registrar no App <ArrowUpRight size={15} /></Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {["Saldo consolidado", "Receitas do período", "Despesas do período"].map((title) => (
          <section key={title} className="min-h-36 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-[#1b1c22]">
            <h2 className="text-sm text-neutral-500">{title}</h2><p className="mt-7 text-sm text-neutral-400">Aguardando integração com dados reais</p>
          </section>
        ))}
      </div>
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 dark:border-white/10 dark:bg-[#1b1c22]">
        <h2 className="text-base font-semibold">Dashboard em construção</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Esta é a estrutura independente do painel. Os módulos serão conectados aos serviços financeiros existentes após validação dos contratos de dados, sem alterar a interface atual do aplicativo.</p>
      </section>
    </div>
  );
}
