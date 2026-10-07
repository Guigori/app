// Persistence for local (browser-only) mode. Everything is kept under one
// localStorage key so "apagar meus dados" is a single removeItem.

import type { Account, CardInput, Category, Transaction } from "@/types/finnos";

import { getMode } from "@/lib/mode";

function storageKey(): string {
  return getMode() === "demo" ? "finnos:demo-db" : "finnos:local-db";
}

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

const IDB_NAME = "finnos-local";
const IDB_VERSION = 1;
const IDB_STORE = "databases";
const memory = new Map<string, LocalDb>();

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key: string): Promise<LocalDb | null> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as LocalDb | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(key: string, value: LocalDb): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function normalizeDb(parsed: Partial<LocalDb>): LocalDb {
  return {
    profile: parsed.profile ?? { name: "Você" },
    accounts: parsed.accounts ?? [],
    categories: parsed.categories ?? [],
    transactions: parsed.transactions ?? [],
    cards: parsed.cards ?? [],
  };
}

function legacyRead(key: string): LocalDb | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try { return normalizeDb(JSON.parse(raw) as Partial<LocalDb>); } catch { return null; }
}

export async function initializeLocalPersistence(): Promise<void> {
  for (const key of ["finnos:local-db", "finnos:demo-db"]) {
    try {
      let value = await idbGet(key);
      if (!value) {
        value = legacyRead(key);
        if (value) {
          await idbPut(key, value);
          window.localStorage.removeItem(key);
        }
      }
      if (value) memory.set(key, normalizeDb(value));
    } catch {
      const legacy = legacyRead(key);
      if (legacy) memory.set(key, legacy);
    }
  }
}

export function readDb(): LocalDb {
  const key = storageKey();
  const cached = memory.get(key);
  if (cached) return cached;
  const legacy = legacyRead(key);
  if (legacy) {
    memory.set(key, legacy);
    return legacy;
  }
  const db = freshDb();
  memory.set(key, db);
  void idbPut(key, db).catch(() => window.localStorage.setItem(key, JSON.stringify(db)));
  return db;
}

export function writeDb(db: LocalDb): void {
  const key = storageKey();
  memory.set(key, db);
  void idbPut(key, db).catch(() => window.localStorage.setItem(key, JSON.stringify(db)));
}

export function wipeDb(): void {
  const key = storageKey();
  memory.delete(key);
  window.localStorage.removeItem(key);
  void idbDelete(key).catch(() => undefined);
}
