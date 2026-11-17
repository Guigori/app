import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mode", () => ({ isLocalMode: () => true }));
import { fetchBudgetClosings, fetchBudgetPlans, reopenBudgetClosing, saveBudgetClosing, saveBudgetPlan, emptyPlan } from "@/lib/budget/server";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k), clear: () => storage.clear() });

describe("Orçamento por mês sem conta (modo local)", () => {
  beforeEach(() => storage.clear());

  it("keeps one plan per month, replaced as a whole", async () => {
    await saveBudgetPlan({ ...emptyPlan("2026-12"), approved: ["fx:Luz:2026-12-22"], planned_income: 5800 });
    await saveBudgetPlan({ ...emptyPlan("2026-12"), approved: [], planned_income: 6000 });
    const plans = await fetchBudgetPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ month: "2026-12", approved: [], planned_income: 6000 });
  });

  it("closing and reopening a month only touch the Orçamento's snapshot", async () => {
    await saveBudgetClosing({ month: "2026-10", closed_at: "2026-11-01T00:00:00Z", earned: 6050, spent: 5750, result: 300, daily_planned: 1350, daily_spent: 1410, allocation: [], categories: [] });
    expect((await fetchBudgetClosings()).map((c) => c.month)).toEqual(["2026-10"]);
    await reopenBudgetClosing("2026-10");
    expect(await fetchBudgetClosings()).toEqual([]);
  });
});
