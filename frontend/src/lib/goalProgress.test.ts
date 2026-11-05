import { describe, expect, it } from "vitest";
import type { FinnosGoal } from "@/lib/goals";
import { addDeposit, contribute, goalHistory, goalPlan, goalProgress, moveBetweenGoals, withdraw } from "./goalProgress";

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

describe("goal movements and history", () => {
  const base = { id: "a", name: "Notebook", category: "Compras", mode: "inteligente", target: 6000, saved: 500, months: 6, contribution: 911.16,
    frequency: "Mensal", account: "reserva", strategy: "equilibrado", remind: true, radar: true, createdAt: "2026-09-01T12:00:00Z", deposits: [] } as FinnosGoal;

  it("records where a contribution came from and never passes the target", () => {
    const g = contribute(base, 1000, "2026-10-05", { accountId: "nubank", note: "13º" });
    expect(g.saved).toBe(1500);
    expect(g.deposits?.[0]).toEqual({ date: "2026-10-05", value: 1000, kind: "aporte", account_id: "nubank", goal_id: null, note: "13º" });
    expect(contribute(base, 99999, "2026-10-05").saved).toBe(6000);
  });

  it("takes money out, never more than the goal has", () => {
    const g = withdraw(contribute(base, 1000, "2026-10-05"), 2000, "2026-11-02", { accountId: "itau" });
    expect(g.saved).toBe(0);
    expect(g.deposits?.at(-1)).toMatchObject({ kind: "retirada", value: 1500, account_id: "itau" });
  });

  it("moves money between goals, limited by the room in the second", () => {
    const trip = { ...base, id: "b", name: "Viagem", target: 1000, saved: 900 };
    const [from, to, moved] = moveBetweenGoals(contribute(base, 1000, "2026-10-05"), trip, 300, "2026-11-02");
    expect(moved).toBe(100);
    expect(from.saved).toBe(1400);
    expect(to.saved).toBe(1000);
    expect(to.deposits?.at(-1)).toMatchObject({ kind: "aporte", goal_id: "a" });
  });

  it("lists the whole history with the balance after each movement and the starting amount", () => {
    const g = withdraw(contribute(contribute(base, 1000, "2026-10-05"), 200, "2026-10-20"), 300, "2026-11-02");
    expect(goalHistory(g).map((r) => [r.date, r.kind, r.value, r.balance, Boolean(r.initial)])).toEqual([
      ["2026-11-02", "retirada", 300, 1400, false],
      ["2026-10-20", "aporte", 200, 1700, false],
      ["2026-10-05", "aporte", 1000, 1500, false],
      ["2026-09-01", "aporte", 500, 500, true],
    ]);
  });

  it("says what is left, how much a month it takes and when it ends", () => {
    const g = contribute(contribute(base, 1000, "2026-10-05"), 600, "2026-11-02");
    const plan = goalPlan(g, g.saved, "2026-11-05");
    expect(plan).toMatchObject({ remaining: 3900, deadline: "2027-03", neededPerMonth: 975, pacePerMonth: 800, finishAtPlan: "2027-04", finishAtPace: "2027-04" });
  });
});
