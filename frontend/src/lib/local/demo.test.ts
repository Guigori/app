import { afterEach, expect, test, vi } from "vitest";
import { enableDemoMode, enableLocalMode, getMode, isLocalMode } from "../mode";
import { localLoadDemo } from "./engine";
import { freshDb, readDb, writeDb } from "./store";

afterEach(() => vi.unstubAllGlobals());

test("demo opens with sample finances and preserves the personal local database", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  enableLocalMode();
  writeDb(freshDb("Igor"));
  const personal = values.get("finnos:local-db");
  enableDemoMode();
  localLoadDemo();
  expect(getMode()).toBe("demo");
  expect(isLocalMode()).toBe(true);
  expect(readDb().accounts).toHaveLength(4);
  expect(readDb().transactions.length).toBeGreaterThan(0);
  expect(values.get("finnos:local-db")).toBe(personal);
  enableLocalMode();
  expect(readDb().profile.name).toBe("Igor");
  expect(readDb().accounts).toHaveLength(0);
  const preserved = JSON.stringify(readDb());
  expect(() => localLoadDemo()).toThrow("modo demonstração");
  expect(JSON.stringify(readDb())).toBe(preserved);
});

test("a new personal local database has no sample financial amounts", () => {
  const db = freshDb();
  expect(db.accounts).toHaveLength(0);
  expect(db.cards).toHaveLength(0);
  expect(db.transactions).toHaveLength(0);
  expect(db.categories.every((category) => category.monthly_budget === 0 && category.monthly_goal === 0)).toBe(true);
  expect(freshDb("Demonstração", true).categories.some((category) => category.monthly_budget > 0)).toBe(true);
});
