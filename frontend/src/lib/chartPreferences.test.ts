import { beforeEach, describe, expect, it, vi } from "vitest";

// Node has no browser storage: a plain one, kept between "app openings" in a test.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });

const { CHART_PREFERENCES_KEY, pickMany, pickOne, saveChartPreference } = await import("@/lib/chartPreferences");

beforeEach(() => store.clear());

describe("Home chart preferences", () => {
  it("are written to the device storage, so they survive closing the app", () => {
    saveChartPreference("view", "Linhas");
    saveChartPreference("projection", ["balance", "expense"]);
    expect(JSON.parse(store.get(CHART_PREFERENCES_KEY)!)).toEqual({ view: "Linhas", projection: ["balance", "expense"] });
    // Saving one choice keeps the others.
    saveChartPreference("interval", "3 meses");
    expect(JSON.parse(store.get(CHART_PREFERENCES_KEY)!)).toMatchObject({ view: "Linhas", interval: "3 meses" });
  });

  it("only accept known choices, falling back to the default", () => {
    expect(pickOne("Pizza", ["Projeção", "Pizza"] as const, "Projeção")).toBe("Pizza");
    expect(pickOne("Radar", ["Projeção", "Pizza"] as const, "Projeção")).toBe("Projeção");
    expect(pickOne(undefined, ["Projeção"] as const, "Projeção")).toBe("Projeção");
    expect(pickMany(["balance", "x", "balance"], ["balance", "income"] as const, ["income"])).toEqual(["balance"]);
    expect(pickMany([], ["balance"] as const, ["balance"])).toEqual(["balance"]);
    expect(pickMany([], ["Receitas"] as const, [], true)).toEqual([]);
    expect(pickMany("oops", ["balance"] as const, ["balance"])).toEqual(["balance"]);
  });
});
