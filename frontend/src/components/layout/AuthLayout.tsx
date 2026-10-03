import type { ReactNode } from "react";
import { FinnosIcon, FinnosLogo } from "@/components/brand/FinnosLogo";

export function AuthLayout({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="flex flex-col justify-between border-b border-border bg-background px-6 py-7 text-foreground sm:px-10 lg:min-h-svh lg:border-b-0 lg:border-r lg:p-12 xl:p-16">
        <FinnosLogo className="w-40 sm:w-48" />
        <div className="hidden max-w-lg py-12 lg:block">
          <FinnosIcon className="mb-8 h-20 w-20" />
          <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
            {signup ? "Comece a enxergar seu dinheiro com clareza." : "Sua vida financeira em um só lugar."}
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
            Receitas, despesas e contas organizadas para você acompanhar o presente e planejar o futuro.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3 border-t border-border pt-6">
            {[["50%", "Necessidades"], ["30%", "Desejos"], ["20%", "Metas"]].map(([value, label]) => (
              <div key={label}>
                <p className="font-heading text-2xl font-bold text-primary">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="hidden text-xs text-muted-foreground lg:block">Mais clareza para cuidar do seu dinheiro.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-8 sm:px-8 sm:py-12 lg:p-12">
        {children}
      </main>
    </div>
  );
}
