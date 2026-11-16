/**
 * Device copy parity (camada 6). The emulator job writes the server's copy of a synthetic account
 * (/api/finance/mirror) and the server's answers for the same revision; this computes the same screens with the
 * app's local engine on that copy and compares them with the same rules the app uses in shadow (lib/mirror.ts).
 * Skipped unless SHADOW_FIXTURES points at those files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync } from "node:fs";
import { asLocalDb, compareWhole, comparisons } from "@/lib/mirror";
import { withReadOnlyDb } from "@/lib/local/store";
import {
  localBalanceHistory, localBudget, localCalendar, localDashboard, localFlow, localInvoice, localListAccounts,
  localListCards, localListCategories, localListInstitutions, localListTransactions, localNotifications,
  localSubscriptions, localTrends,
} from "@/lib/local/engine";
import { localRadar } from "@/lib/local/radar";

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
    trends: () => localTrends(6),
    budget: (url) => localBudget(new URL(url, "http://x").searchParams.get("month") as string),
    flow: (url) => localFlow({ month: new URL(url, "http://x").searchParams.get("month") ?? undefined } as never),
    cards: () => localListCards(),
    invoice: () => localInvoice("card"),
    subscriptions: () => localSubscriptions(),
    transactions: (url) => localListTransactions({ month: new URL(url, "http://x").searchParams.get("month") ?? undefined } as never),
    radar: () => localRadar(),
    notifications: () => localNotifications(),
    categories: () => localListCategories(),
    institutions: () => localListInstitutions(),
  };
  const required = new Set(["dashboard", "calendar", "balanceHistory", "accounts"]);

  for (const [screen, byUrl] of Object.entries((answers ?? {}) as Record<string, Record<string, unknown>>)) {
    for (const [url, server] of Object.entries(byUrl)) {
      it(`${screen} ${url}`, () => {
        let device: unknown;
        try {
          device = withReadOnlyDb(asLocalDb(mirror), () => engines[screen](url));
        } catch (error) {
          device = { error: String(error) };
        }
        const rule = (comparisons as Record<string, ((a: unknown, b: unknown) => unknown[]) | undefined>)[screen];
        const diff = rule ? rule(server, device) : compareWhole(server, device);
        if (required.has(screen)) expect(diff).toEqual([]);
        else if (process.env.GITHUB_STEP_SUMMARY) {
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n#### ${screen} ${url}: ${diff.length ? "diferente" : "igual"}\n\n\`\`\`\n${JSON.stringify(diff, null, 1).slice(0, 3000)}\n\`\`\`\n`);
        }
      });
    }
  }
});
