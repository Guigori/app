import { afterEach, expect, test, vi } from "vitest";
import { enableDemoMode, enableLocalMode, getMode, isLocalMode } from "../mode";
import { localLoadDemo } from "./engine";
import { freshDb, readDb, writeDb } from "./store";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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
});

test("demo loads on the first day of the month without paid future rows", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 1, 12));
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  enableDemoMode();
  localLoadDemo();
  const transactions = readDb().transactions;
  expect(transactions.length).toBeGreaterThan(0);
  expect(transactions.filter((t) => t.status === "pago" && t.date > "2026-11-01")).toHaveLength(0);
  expect(transactions.some((t) => t.status === "agendado" && t.date > "2026-11-01")).toBe(true);
});
