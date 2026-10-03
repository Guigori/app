import type { ReactNode } from "react";
import { FinnosIcon, FinnosLogo } from "@/components/brand/FinnosLogo";

export function AuthLayout({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  return (
    <div className="min-h-svh bg-[linear-gradient(180deg,#5B35FF_0%,#070F52_58%,#03081F_100%)] lg:grid lg:grid-cols-[0.95fr_1.05fr] lg:bg-white">
      <aside className="relative hidden min-h-svh overflow-hidden border-r border-white/10 bg-[linear-gradient(0deg,#4B2CFF_0%,#070F52_48%,#03081F_100%)] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        <FinnosLogo variant="dark" className="relative z-10 w-48" />
        <div className="relative z-10 max-w-xl py-10">
          <FinnosIcon className="pointer-events-none absolute -right-36 -top-48 h-[34rem] w-[34rem] rotate-[-14deg] opacity-35 xl:-right-48 xl:h-[40rem] xl:w-[40rem]" />
          <div className="relative z-10 pt-44">
            <h1 className="font-heading text-5xl font-bold leading-[1.05] tracking-tight xl:text-6xl">
              {signup ? "Comece a enxergar seu dinheiro com clareza." : "Sua vida financeira em um só lugar."}
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/70">
              Receitas, despesas e contas organizadas para você acompanhar o presente e planejar o futuro.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-5 border-t border-white/20 pt-7">
              {[["50%", "Necessidades"], ["30%", "Desejos"], ["20%", "Metas"]].map(([value, label]) => (
                <div key={label}>
                  <p className="font-heading text-3xl font-bold text-[#9B6CFF]">{value}</p>
                  <p className="mt-1 text-sm text-white/70">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <span />
      </aside>
      <main className="flex min-h-svh items-center justify-center px-4 py-8 sm:px-8 lg:bg-white lg:p-12">
        {children}
      </main>
    </div>
  );
}