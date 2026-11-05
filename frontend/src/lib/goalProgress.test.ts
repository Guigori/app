import { describe, expect, it } from "vitest";
import type { FinnosGoal } from "@/lib/goals";
import { addDeposit, goalProgress } from "./goalProgress";

const goal = (over: Partial<FinnosGoal> = {}): FinnosGoal => ({
  id: "g", name: "Notebook", category: "Tecnologia", mode: "tradicional", target: 6000, saved: 500, months: 10,
  contribution: 500, frequency: "Mensal", account: "a", strategy: null, remind: true, radar: true,
  createdAt: "2026-08-04T12:00:00Z", ...over,
});

describe("goalProgress", () => {
  it("compares with what the plan expected by today", () => {
    // Created 3 months ago with R$ 500 already saved and R$ 500/month planned → R$ 2.000 expected.
    const p = goalProgress(goal(), null, "2026-11-04");
    expect(p).toMatchObject({ saved: 500, expected: 2000, status: "atrasada", behindBy: 1500 });
  });
  it("is on pace when contributions kept up", () => {
    const g = ["2026-09-05", "2026-10-05", "2026-11-01"].reduce((acc, date) => addDeposit(acc, 500, date), goal());
    expect(goalProgress(g, null, "2026-11-04")).toMatchObject({ saved: 2000, status: "no-ritmo", lastDeposit: { date: "2026-11-01", value: 500 } });
  });
  it("can follow a dedicated account's balance", () => {
    const p = goalProgress(goal({ track_account: true }), 6500, "2026-11-04");
    expect(p).toMatchObject({ saved: 6000, percent: 100, status: "concluida", tracking: true });
  });
});

describe("addDeposit", () => {
  it("never goes past the target", () => {
    const g = addDeposit(goal({ saved: 5800 }), 500, "2026-11-04");
    expect(g.saved).toBe(6000);
    expect(g.deposits).toEqual([{ date: "2026-11-04", value: 200 }]);
  });
});
