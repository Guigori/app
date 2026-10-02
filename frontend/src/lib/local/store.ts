// Persistence for local (browser-only) mode. Everything is kept under one
// localStorage key so "apagar meus dados" is a single removeItem.

import type { Account, CardInput, Category, Transaction } from "@/types/finnos";

const KEY = "finnos:local-db";

export interface LocalProfile {
  name: string;
}

/** Stored shape of a card: the input fields plus identity. Invoice/limit numbers are
 *  always derived at read time, exactly like the backend does. */
export interface LocalCard extends CardInput {
  id: string;
  created_at: string;
}

export interface LocalDb {
  profile: LocalProfile;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  cards: LocalCard[];
}

export const DEFAULT_CATEGORIES: Omit<Category, "id" | "created_at">[] = [
  { name: "Alimentação", icon: "utensils", color: "#F59E0B", group: "necessidades", monthly_budget: 900, monthly_goal: 0 },
  { name: "Mercado", icon: "shopping-cart", color: "#84CC16", group: "necessidades", monthly_budget: 600, monthly_goal: 0 },
  { name: "Moradia", icon: "home", color: "#5B3FE4", group: "necessidades", monthly_budget: 1600, monthly_goal: 0 },
  { name: "Transporte", icon: "car", color: "#06B6D4", group: "necessidades", monthly_budget: 400, monthly_goal: 0 },
  { name: "Saúde", icon: "heart-pulse", color: "#10B981", group: "necessidades", monthly_budget: 300, monthly_goal: 0 },
  { name: "Educação", icon: "graduation-cap", color: "#6366F1", group: "necessidades", monthly_budget: 350, monthly_goal: 0 },
  { name: "Lazer", icon: "gamepad-2", color: "#8B74F0", group: "desejos", monthly_budget: 300, monthly_goal: 0 },
  { name: "Restaurantes", icon: "coffee", color: "#F97316", group: "desejos", monthly_budget: 250, monthly_goal: 0 },
  { name: "Compras", icon: "shopping-bag", color: "#EC4899", group: "desejos", monthly_budget: 300, monthly_goal: 0 },
  { name: "Assinaturas", icon: "repeat", color: "#F43F5E", group: "desejos", monthly_budget: 150, monthly_goal: 0 },
  { name: "Viagem", icon: "plane", color: "#0EA5E9", group: "desejos", monthly_budget: 200, monthly_goal: 0 },
  { name: "Investimentos", icon: "trending-up", color: "#059669", group: "metas", monthly_budget: 1000, monthly_goal: 0 },
  { name: "Metas", icon: "piggy-bank", color: "#7C3AED", group: "metas", monthly_budget: 400, monthly_goal: 0 },
  { name: "Renda", icon: "wallet", color: "#047857", group: "necessidades", monthly_budget: 0, monthly_goal: 0 },
  { name: "Outros", icon: "more-horizontal", color: "#64748B", group: "desejos", monthly_budget: 0, monthly_goal: 0 },
];

export function newId(): string {
  return crypto.randomUUID();
}

export function freshDb(name = "Você"): LocalDb {
  const now = new Date().toISOString();
  return {
    profile: { name },
    accounts: [],
    transactions: [],
    cards: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, id: newId(), created_at: now })),
  };
}

export function readDb(): LocalDb {
  const raw = window.localStorage.getItem(KEY);
  if (!raw) {
    const db = freshDb();
    writeDb(db);
    return db;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LocalDb>;
    return {
      profile: parsed.profile ?? { name: "Você" },
      accounts: parsed.accounts ?? [],
      categories: parsed.categories ?? [],
      transactions: parsed.transactions ?? [],
      cards: parsed.cards ?? [],
    };
  } catch {
    const db = freshDb();
    writeDb(db);
    return db;
  }
}

export function writeDb(db: LocalDb): void {
  window.localStorage.setItem(KEY, JSON.stringify(db));
}

export function wipeDb(): void {
  window.localStorage.removeItem(KEY);
}
