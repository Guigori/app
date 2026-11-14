import {
  GitCompareArrows,
  Home,
  PieChart,
  ChartNoAxesCombined,
  Radar,
  Repeat,
  Tags,
  Landmark,
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

/** A titled block of the menu. Items are slugs of MAIN_NAV, in their default order. */
export interface NavGroup {
  /** Section caption. `null` for the first (uncaptioned) block. */
  label: string | null;
  items: string[];
}

/**
 * Every place the navigation can lead to. The menu shows the places where you see and work on your
 * money; how the app works (theme, categories, data…) lives in Configurações, and who you are
 * (name, account, sign out) in Meu perfil.
 */
export const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Fluxo", icon: GitCompareArrows, slug: "transacoes" },
  { to: "/contas", label: "Carteira", icon: Wallet, slug: "contas" },
  { to: "/orcamento", label: "Orçamento", icon: PieChart, slug: "orcamento" },
  { to: "/radar", label: "Radar", icon: Radar, slug: "radar" },
  { to: "/patrimonio", label: "Patrimônio", icon: Landmark, slug: "patrimonio" },
  { to: "/analise", label: "Análise", icon: ChartNoAxesCombined, slug: "analise" },
  { to: "/assinaturas", label: "Assinaturas", icon: Repeat, slug: "assinaturas" },
  // Not in the menu (it is set up once, in Configurações), but it can still be a bottom-bar tab.
  { to: "/categorias", label: "Categorias", icon: Tags, slug: "categorias" },
];

export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: ["inicio", "transacoes", "contas"] },
  { label: "Planejar", items: ["orcamento", "radar", "patrimonio"] },
  { label: "Analisar", items: ["analise", "assinaturas"] },
];

/** Every item the menu can show, in its default order. */
export const MENU_SLUGS: string[] = NAV_GROUPS.flatMap((group) => group.items);

/** Horizontal tab strip under the header (Calen's Início · Fluxo · Categorias …). */
export const TOP_TABS: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Fluxo", icon: GitCompareArrows, slug: "transacoes" },
  { to: "/analise", label: "Análise", icon: ChartNoAxesCombined, slug: "analise" },
  { to: "/orcamento", label: "Orçamento", icon: PieChart, slug: "orcamento" },
  { to: "/categorias", label: "Categorias", icon: Tags, slug: "categorias" },
  { to: "/contas", label: "Carteira", icon: Wallet, slug: "contas" },
];

/** Bottom bar on mobile — the central "+" sits between these two pairs. */
export const BOTTOM_LEFT: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Fluxo", icon: GitCompareArrows, slug: "transacoes" },
];

export const BOTTOM_RIGHT: NavItem[] = [
  { to: "/analise", label: "Análise", icon: ChartNoAxesCombined, slug: "analise" },
  { to: "/contas", label: "Carteira", icon: Wallet, slug: "contas" },
];

export const PAGE_TITLES: Record<string, string> = {
  "/": "Início",
  "/transacoes": "Fluxo",
  "/contas": "Carteira",
  "/analise": "Análise",
  "/categorias": "Categorias",
  "/fluxo": "Caixa", 
  "/orcamento": "Orçamento",
  "/radar": "Radar",
  "/cartoes": "Cartões",
  "/assinaturas": "Assinaturas",
  "/patrimonio": "Patrimônio",
  "/metas": "Patrimônio",
  "/investimentos": "Patrimônio",
  "/configuracoes": "Configurações",
};
