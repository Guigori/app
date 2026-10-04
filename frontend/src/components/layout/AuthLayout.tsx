import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FinnosIcon, FinnosLogo } from "@/components/brand/FinnosLogo";

export function AuthLayout({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  const [mobileIntroDone, setMobileIntroDone] = useState(false);

  return (
    <div className="min-h-svh bg-white lg:grid lg:h-svh lg:grid-cols-[0.9fr_1.1fr] lg:overflow-hidden">
      {!mobileIntroDone ? (
        <section className="relative flex min-h-svh flex-col overflow-hidden bg-[linear-gradient(0deg,#4B2CFF_0%,#070F52_46%,#020619_100%)] px-7 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-white lg:hidden">
          <div className="absolute inset-x-0 top-0 h-[32%] bg-[linear-gradient(180deg,rgba(0,0,0,.30),transparent)]" />
          <FinnosLogo variant="dark" className="relative z-20 w-44" />
          <FinnosIcon className="pointer-events-none absolute right-[-32%] top-[10%] h-[55vh] w-[55vh] rotate-[-14deg] opacity-30" />
          <div className="relative z-10 mt-auto mb-7">
            <h1 className="font-heading text-[clamp(3rem,13vw,4.5rem)] font-bold leading-[.98] tracking-tight">
              {signup ? "Comece a enxergar seu dinheiro com clareza." : "Sua vida financeira em um só lugar."}
            </h1>
            <p className="mt-6 text-[clamp(1rem,4.8vw,1.25rem)] leading-relaxed text-white/75">
              Receitas, despesas e contas organizadas para você{" "}
              <span className="auth-slogan-typing font-medium text-white">acompanhar o presente e planejar o futuro.</span>
            </p>
            <button
              type="button"
              onClick={() => setMobileIntroDone(true)}
              className="mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-[#070F52] shadow-lg transition active:scale-[.98]"
              data-testid="mobile-auth-continue"
            >
              Continuar
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </section>
      ) : null}

      <aside className="relative hidden h-svh overflow-hidden bg-[linear-gradient(0deg,#4B2CFF_0%,#070F52_46%,#020619_100%)] px-10 py-8 text-white lg:flex lg:flex-col xl:px-14">
        <div className="absolute inset-x-0 top-0 h-[32%] bg-[linear-gradient(180deg,rgba(0,0,0,.30),transparent)]" />
        <FinnosLogo variant="dark" className="relative z-20 w-44 xl:w-48" />
        <FinnosIcon className="pointer-events-none absolute right-[-20%] top-[10%] h-[58vh] w-[58vh] rotate-[-14deg] opacity-26" />
        <div className="relative z-10 mt-auto mb-[9vh] max-w-[38rem]">
          <h1 className="font-heading text-[clamp(2.8rem,4.3vw,4.8rem)] font-bold leading-[1.02] tracking-tight">
            {signup ? "Comece a enxergar seu dinheiro com clareza." : "Sua vida financeira em um só lugar."}
          </h1>
          <p className="mt-5 max-w-[34rem] text-[clamp(.95rem,1.25vw,1.2rem)] leading-relaxed text-white/75">
            Receitas, despesas e contas organizadas para você{" "}
            <span className="auth-slogan-typing font-medium text-white">acompanhar o presente e planejar o futuro.</span>
          </p>
        </div>
      </aside>

      <main className={`${mobileIntroDone ? "flex" : "hidden"} min-h-svh items-start justify-center overflow-x-hidden bg-white px-4 py-3 sm:items-center sm:px-8 sm:py-4 lg:flex lg:h-svh lg:min-h-0 lg:overflow-y-auto lg:px-10 lg:py-5 xl:px-14`}>
        {children}
      </main>
    </div>
  );
}
