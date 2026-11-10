import { describe, expect, it } from "vitest";
import { historyChanges } from "./HistorySheet";

describe("historyChanges", () => {
  const label = (field: string, v: string | number | undefined) => (field === "value_cents" ? `R$ ${Number(v) / 100}` : String(v ?? "—"));
  it("lists only the fields that changed, before → after", () => {
    const changes = historyChanges({ id: "e", action: "updated", created_at: "2026-11-10T10:00:00Z",
      before: { name: "Uber", value_cents: 4500, date: "2026-11-10", source: "manual" },
      after: { name: "Uber", value_cents: 6000, date: "2026-11-09", source: "manual" } }, label);
    expect(changes).toEqual([
      { field: "Valor", before: "R$ 45", after: "R$ 60" },
      { field: "Data", before: "2026-11-10", after: "2026-11-09" },
    ]);
  });
  it("shows a field that appeared or was cleared", () => {
    const changes = historyChanges({ id: "e", action: "updated", created_at: "x", before: { name: "A" }, after: { name: "A", origin: "iFood" } }, label);
    expect(changes).toEqual([{ field: "Origem", before: "—", after: "iFood" }]);
  });
});
