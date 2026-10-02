import { Link } from "react-router-dom";
import { CreditCard, PieChart, PiggyBank, Repeat, TrendingUp, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FinnosDonut } from "@/components/brand/FinnosLogo";

interface ModuleMeta {
  title: string;
  icon: LucideIcon;
  description: string;
  links: { to: string; label: string }[];
}

const MODULES: Record<string, ModuleMeta> = {
  cartoes: {
    title: "Cartões",
    icon: CreditCard,
    description:
      "Gerencie limites, faturas, fechamento e vencimento dos seus cartões de crédito. Você poderá acompanhar a fatura atual, o melhor dia de compra e o limite disponível.",
    links: [
      { to: "/transacoes", label: "Ver transações" },
      { to: "/contas", label: "Ver contas" },
    ],
  },
  orcamento: {
    title: "Orçamento",
    icon: PieChart,
    description:
      "Compare o planejado e o utilizado por categoria, com alertas visuais de limite. Enquanto isso, a regra 50/30/20 já está disponível no painel inicial.",
    links: [{ to: "/", label: "Ver a regra 50/30/20" }],
  },
  assinaturas: {
    title: "Assinaturas",
    icon: Repeat,
    description:
      "Acompanhe Netflix, Spotify, academia e outras cobranças recorrentes, com custo mensal e anual estimado. Hoje, despesas fixas já são marcadas nas transações.",
    links: [{ to: "/transacoes", label: "Ver transações fixas" }],
  },
  metas: {
    title: "Metas",
    icon: PiggyBank,
    description:
      "Reserva de emergência, viagem, entrada do apartamento: acompanhe o progresso de cada objetivo com barra visual e prazo.",
    links: [{ to: "/", label: "Voltar ao início" }],
  },
  investimentos: {
    title: "Investimentos",
    icon: TrendingUp,
    description:
      "CDB, Tesouro, fundos, ações, ETF e cripto em um só lugar, com valor aplicado e valor atual lado a lado.",
    links: [{ to: "/", label: "Voltar ao início" }],
  },
};

export default function ComingSoon({ module }: { module: string }) {
  const meta = MODULES[module];
  if (!meta) {
    return (
      <div className="py-16 text-center">
        <FinnosDonut className="mx-auto h-12 w-12" />
        <h1 className="mt-4 font-heading text-2xl font-bold">Página não encontrada</h1>
        <Link to="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          Voltar ao início
        </Link>
      </div>
    );
  }

  const Icon = meta.icon;
  return (
    <div className="mx-auto max-w-xl py-10 text-center animate-fade-up">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/5 text-primary">
        <Icon className="h-8 w-8" aria-hidden="true" />
      </div>
      <Badge variant="secondary" className="mt-5">Em breve</Badge>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight text-foreground">{meta.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {meta.links.map((link) => (
          <Link key={link.to} to={link.to} className={buttonVariants({ variant: "outline" })} data-testid="coming-soon-link">
            {link.label}
          </Link>
        ))}
      </div>
      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <FinnosDonut className="h-4 w-4" />
        Este módulo chega em uma próxima entrega do FINNOS.
      </div>
    </div>
  );
}
