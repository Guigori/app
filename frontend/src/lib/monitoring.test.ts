import { describe, expect, it } from "vitest";
import { scrubEvent } from "./monitoring";

describe("scrubEvent", () => {
  it("keeps the error, drops anything that could carry financial data", () => {
    const out = scrubEvent({
      request: { url: "https://finnos.vercel.app/fluxo?month=2026-11", data: { value: 99 }, query_string: "month=2026-11", headers: { Authorization: "Bearer x" } },
      user: { id: "uid" },
      extra: { balance: 1 },
      breadcrumbs: [{ category: "fetch", data: { url: "/api/accounts", status_code: 200 } }, { category: "console", message: "R$ 10" }, { category: "navigation", message: "/fluxo?month=2026-11" }],
    });
    expect(out).toEqual({ request: { url: "https://finnos.vercel.app/fluxo" }, breadcrumbs: [{ category: "fetch" }, { category: "navigation", message: "/fluxo" }] });
  });
});
