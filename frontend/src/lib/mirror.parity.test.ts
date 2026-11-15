/**
 * Device copy parity (camada 6). The emulator job writes the server's copy of a synthetic account
 * (/api/finance/mirror) and the server's answers for the same revision; this computes the same screens with the
 * app's local engine on that copy and compares them with the same rules the app uses in shadow (lib/mirror.ts).
 * Skipped unless SHADOW_FIXTURES points at those files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asLocalDb, comparisons } from "@/lib/mirror";
import { withReadOnlyDb } from "@/lib/local/store";
import { localBalanceHistory, localCalendar, localDashboard, localListAccounts } from "@/lib/local/engine";

const dir = process.env.SHADOW_FIXTURES;

describe.skipIf(!dir)("device copy gives the server's numbers", () => {
  const read = (name: string) => JSON.parse(readFileSync(join(dir as string, name), "utf-8"));
  const mirror = dir ? read("mirror.json") : null;
  const { today, answers } = dir ? read("answers.json") : { today: "", answers: {} };

  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${today}T12:00:00`)); });
  afterAll(() => vi.useRealTimers());

  const engines: Record<string, (url: string) => unknown> = {
    dashboard: (url) => localDashboard(new URL(url, "http://x").searchParams.get("month")),
    calendar: (url) => localCalendar(new URL(url, "http://x").searchParams.get("month") as string),
    balanceHistory: (url) => localBalanceHistory(new URL(url, "http://x").searchParams.get("month") as string),
    accounts: () => localListAccounts(),
  };

  for (const [screen, byUrl] of Object.entries((answers ?? {}) as Record<string, Record<string, unknown>>)) {
    for (const [url, server] of Object.entries(byUrl)) {
      it(`${screen} ${url}`, () => {
        const device = withReadOnlyDb(asLocalDb(mirror), () => engines[screen](url));
        const compare = comparisons[screen as keyof typeof comparisons] as (a: unknown, b: unknown) => unknown[];
        expect(compare(server, device)).toEqual([]);
      });
    }
  }
});
