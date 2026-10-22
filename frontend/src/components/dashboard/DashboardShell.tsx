import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Wallet, ArrowLeftRight, ChartNoAxesCombined, Radar, Settings2 } from "lucide-react";

const links = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/contas", label: "Carteira", icon: Wallet },
  { to: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/analise", label: "Análises", icon: ChartNoAxesCombined },
  { to: "/radar", label: "Radar", icon: Radar },
  { to: "/configuracoes", label: "Configurações", icon: Settings2 },
];

/** Dedicated desktop dashboard shell; deliberately does not mount AppShell or its mobile FAB/nav. */
export function DashboardShell() {
  return (
    <div className="min-h-svh bg-[#f7f7f5] text-[#1e2027] dark:bg-[#111217] dark:text-[#f4f4f5]">
      <div className="mx-auto flex min-h-svh max-w-[1920px]">
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-black/[0.06] bg-white px-4 py-6 dark:border-white/10 dark:bg-[#17181e] md:flex">
          <NavLink to="/dashboard" className="px-3 text-xl font-semibold tracking-tight">FINNOS<span className="text-[#5b35ff]">.</span></NavLink>
          <p className="mt-1 px-3 text-xs text-neutral-500">Painel financeiro</p>
          {/* Until dashboard-specific module views exist, these links open the functional App pages. */}
          <nav aria-label="Dashboard" className="mt-9 flex flex-col gap-1">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? "bg-[#f0efff] font-medium text-[#4b2cff] dark:bg-[#30274b] dark:text-[#b5a2ff]" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10"}`}>
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
          <NavLink to="/" className="mt-auto px-3 text-xs text-neutral-500 hover:underline">Voltar ao FINNOS App</NavLink>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex min-h-16 items-center justify-between border-b border-black/[0.06] bg-white px-5 dark:border-white/10 dark:bg-[#17181e] md:px-9">
            <div className="text-sm font-medium">FINNOS / Dashboard</div>
            <NavLink to="/" className="text-xs text-[#5b35ff] hover:underline md:hidden">Abrir App</NavLink>
          </header>
          <main className="mx-auto max-w-[1500px] p-5 md:p-9"><Outlet /></main>
        </div>
      </div>
    </div>
  );
}
