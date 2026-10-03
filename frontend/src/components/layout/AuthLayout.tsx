import type { ReactNode } from "react";
import { FinnosIcon, FinnosLogo } from "@/components/brand/FinnosLogo";

export function AuthLayout({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  return (
    <div className="h-svh overflow-hidden bg-[linear-gradient(180deg,#5B35FF_0%,#070F52_58%,#03081F_100%)] lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:bg-white">
      <aside className="relative hidden h-svh overflow-hidden bg-[linear-gradient(0deg,#4B2CFF_0%,#070F52_48%,#03081F_100%)] px-10 py-8 text-white lg:flex lg:flex-col xl:px-14">
        <FinnosLogo variant="dark" className="relative z-20 w-44 xl:w-48" />
        <FinnosIcon className="pointer-events-none absolute right-[-20%] top-[10%] h-[58vh] w-[58vh] rotate-[-14deg] opacity-30" />
        <div className="relative z-10 mt-auto mb-[7vh] max-w-[38rem]">
          <h1 className="font-heading text-[clamp(2.8rem,4.3vw,4.8rem)] font-bold leading-[1.02] tracking-tight">
            {signup ? "Comece a enxergar seu dinheiro com clareza." : "Sua vida financeira em um só lugar."}
          </h1>
          <p className="mt-5 max-w-[34rem] text-[clamp(.95rem,1.25vw,1.2rem)] leading-relaxed text-white/70">
            Receitas, despesas e contas organizadas para você acompanhar o presente e planejar o futuro.
          </p>
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-white/20 pt-5">
            {[["50%", "Necessidades"], ["30%", "Desejos"], ["20%", "Metas"]].map(([value, label]) => (
              <div key={label}>
                <p className="font-heading text-[clamp(1.6rem,2.3vw,2.4rem)] font-bold text-[#9B6CFF]">{value}</p>
                <p className="mt-0.5 text-sm text-white/70">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <main className="flex h-svh items-center justify-center overflow-y-auto px-4 py-4 sm:px-8 lg:bg-white lg:px-10 lg:py-5 xl:px-14">
        {children}
      </main>
    </div>
  );
}