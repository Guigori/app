import {
  CreditCard,
  Home,
  LayoutList,
  PieChart,
  PiggyBank,
  Repeat,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  slug: string;
}

export const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Transações", icon: LayoutList, slug: "transacoes" },
  { to: "/contas", label: "Contas", icon: Wallet, slug: "contas" },
  { to: "/cartoes", label: "Cartões", icon: CreditCard, soon: true, slug: "cartoes" },
  { to: "/orcamento", label: "Orçamento", icon: PieChart, soon: true, slug: "orcamento" },
  { to: "/assinaturas", label: "Assinaturas", icon: Repeat, soon: true, slug: "assinaturas" },
  { to: "/metas", label: "Metas", icon: PiggyBank, soon: true, slug: "metas" },
  { to: "/investimentos", label: "Investimentos", icon: TrendingUp, soon: true, slug: "investimentos" },
];

export const SETTINGS_NAV: NavItem[] = [
  { to: "/configuracoes", label: "Configurações", icon: Settings, slug: "configuracoes" },
];

export const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  [...MAIN_NAV, { to: "/configuracoes", label: "Configurações" }, { to: "/categorias", label: "Categorias" }].map(
    (item) => [item.to, item.label],
  ),
);
