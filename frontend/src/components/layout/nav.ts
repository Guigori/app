import {
  ArrowUpDown,
  CalendarDays,
  CreditCard,
  Home,
  PieChart,
  PiggyBank,
  Repeat,
  Radar,
  Settings,
  Sparkles,
  Tags,
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

export interface NavGroup {
  /** Section caption, Calen-style. `null` for the first (uncaptioned) block. */
  label: string | null;
  /** Dot colour beside the caption — the only decorative cue, never the sole signal. */
  dot?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { to: "/", label: "Início", icon: Home, slug: "inicio" },
      { to: "/transacoes", label: "Fluxo", icon: CalendarDays, slug: "transacoes" },
      { to: "/contas", label: "Contas e cartões", icon: Wallet, slug: "contas" },
      { to: "/configuracoes#ia", label: "FINNOS IA", icon: Sparkles, slug: "ia" },
    ],
  },
  {
    label: "Planejar",
    dot: "#10B981",
    items: [
      { to: "/fluxo", label: "Fluxo", icon: ArrowUpDown, slug: "fluxo" },
      { to: "/orcamento", label: "Orçamento", icon: PieChart, slug: "orcamento" },
      { to: "/radar", label: "Radar", icon: Radar, slug: "radar" },
      { to: "/metas", label: "Metas", icon: PiggyBank, soon: true, slug: "metas" },
    ],
  },
  {
    label: "Analisar",
    dot: "#F97316",
    items: [
      { to: "/categorias", label: "Categorias", icon: Tags, slug: "categorias" },
      { to: "/cartoes", label: "Cartões", icon: CreditCard, slug: "cartoes" },
      { to: "/assinaturas", label: "Assinaturas", icon: Repeat, slug: "assinaturas" },
      { to: "/investimentos", label: "Investimentos", icon: TrendingUp, soon: true, slug: "investimentos" },
    ],
  },
  {
    label: "Ajustes",
    dot: "#6366F1",
    items: [{ to: "/configuracoes", label: "Configurações do app", icon: Settings, slug: "configuracoes" }],
  },
];

export const MAIN_NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Horizontal tab strip under the header (Calen's Início · Fluxo · Categorias …). */
export const TOP_TABS: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Fluxo", icon: CalendarDays, slug: "transacoes" },
  { to: "/fluxo", label: "Fluxo", icon: ArrowUpDown, slug: "fluxo" },
  { to: "/orcamento", label: "Orçamento", icon: PieChart, slug: "orcamento" },
  { to: "/categorias", label: "Categorias", icon: Tags, slug: "categorias" },
  { to: "/contas", label: "Contas", icon: Wallet, slug: "contas" },
];

/** Bottom bar on mobile — the central "+" sits between these two pairs. */
export const BOTTOM_LEFT: NavItem[] = [
  { to: "/", label: "Início", icon: Home, slug: "inicio" },
  { to: "/transacoes", label: "Fluxo", icon: CalendarDays, slug: "transacoes" },
];

export const BOTTOM_RIGHT: NavItem[] = [
  { to: "/fluxo", label: "Fluxo", icon: ArrowUpDown, slug: "fluxo" },
  { to: "/contas", label: "Contas", icon: Wallet, slug: "contas" },
];

export const PAGE_TITLES: Record<string, string> = {
  "/": "Início",
  "/transacoes": "Fluxo",
  "/contas": "Contas",
  "/categorias": "Categorias",
  "/fluxo": "Fluxo",
  "/orcamento": "Orçamento",
  "/radar": "Radar",
  "/cartoes": "Cartões",
  "/assinaturas": "Assinaturas",
  "/metas": "Metas",
  "/investimentos": "Investimentos",
  "/configuracoes": "Configurações",
};
