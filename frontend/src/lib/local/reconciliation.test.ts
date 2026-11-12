import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/lib/mode", () => ({ getMode: () => "local", isLocalMode: () => true }));

import { freshDb, readDb, writeDb } from "@/lib/local/store";
import {
  localAdjustBalance, localCompleteReconciliation, localCreateReconciliation, localGetReconciliation, localListAccounts,
  localResolveReconciliation, localUndoReconciliationEvent,
} from "@/lib/local/engine";
import { matchLines } from "@/lib/statementMatching";
import type { ReconciliationInput, Transaction } from "@/types/finnos";

// Same scenario as finnos/tests/test_reconciliations.py (local mode mirror).
const tx = (id: string, date: string, name: string, value: number, type: Transaction["type"] = "despesa", extra: Partial<Transaction> = {}) =>
  ({ id, date, name, value, type, status: "pago", account_id: "acc", card_id: null, created_at: "2026-10-01T12:00:00Z", version: 1, ...extra }) as Transaction;

function scenario(): void {
  const db = freshDb("Test");
  db.accounts = [{ id: "acc", name: "Itaú", initial_balance: 1000, institution: "Itaú", type: "corrente", color: "#EC7000",
    active: true, created_at: "2026-01-01T00:00:00Z", balance: 0, total_income: 0, total_expense: 0 }];
  db.transactions = [tx("a", "2026-10-05", "Padaria Aurora", 18.5), tx("d", "2026-10-15", "Netflix", 49.9),
    tx("e", "2026-10-25", "Aluguel", 1500), tx("s", "2026-10-02", "Salário", 3000, "receita")];
  writeDb(db);
}

const STATEMENT: ReconciliationInput["lines"] = [
  { date: "2026-10-02", description: "SALARIO EMPRESA", value: 3000, direction: "in", fitid: "F1" },
  { date: "2026-10-05", description: "PIX ENVIADO PADARIA AURORA", value: 18.5, direction: "out", fitid: "F2" },
  { date: "2026-10-15", description: "NETFLIX", value: 55.9, direction: "out", fitid: "F3" },
  { date: "2026-10-20", description: "TARIFA PACOTE", value: 29.9, direction: "out", fitid: "F4" },
];
const create = (closing: number | null = 1000 + 3000 - 18.5 - 55.9 - 29.9) => localCreateReconciliation("acc", {
  period_start: "2026-10-01", period_end: "2026-10-31", file_name: "extrato.ofx", file_hash: "abcdef123456", source: "ofx",
  bank_closing_balance: closing, lines: STATEMENT,
});

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
  scenario();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("levels match the server rules", () => {
  const lines = STATEMENT.map((l, index) => ({ index, date: l.date, description: l.description, cents: Math.round(l.value * 100), direction: l.direction, origin_key: `k${index}` }));
  const out = matchLines(lines, readDb().transactions, "acc");
  expect([...out.lines.values()].map(r => [r.level, r.tx_id])).toEqual([["strong", "s"], ["strong", "a"], ["value_diff", "d"], ["only_statement", null]]);
  expect(out.onlyFinnos).toEqual(["e"]);
});

it("full conferência: decisions, undo, register-and-link, conferida até and reimport", () => {
  const rec = create();
  expect(rec.lines.map(l => l.state)).toEqual(["matched", "matched", "review", "open"]);
  expect(rec.pending).toBe(3);
  localResolveReconciliation(rec.id, { line: 2, action: "use_bank_value" });
  expect(readDb().transactions.find(t => t.id === "d")?.value).toBe(55.9);
  const first = localGetReconciliation(rec.id).history![0];
  localUndoReconciliationEvent(rec.id, first.id);
  expect(readDb().transactions.find(t => t.id === "d")?.value).toBe(49.9);
  localResolveReconciliation(rec.id, { line: 2, action: "use_bank_value" });
  const db = readDb();
  db.transactions.push(tx("fee", "2026-10-20", "Tarifa pacote", 29.9));
  writeDb(db);
  localResolveReconciliation(rec.id, { line: 3, action: "link", tx_id: "fee" });
  localResolveReconciliation(rec.id, { tx_id: "e", action: "keep_pending" });
  expect(localGetReconciliation(rec.id).pending).toBe(0);
  expect(localCompleteReconciliation(rec.id).status).toBe("concluida");
  expect(localListAccounts().find(a => a.id === "acc")?.reconciled_until).toBe("2026-10-31");
  expect(create().lines.map(l => l.level)).toEqual(["already", "already", "already", "already"]);
});

it("refuses to complete with open items or different balances; adjustment closes the gap", () => {
  const rec = create(1.0);
  expect(() => localCompleteReconciliation(rec.id)).toThrow(/para decidir/);
  localResolveReconciliation(rec.id, { line: 2, action: "keep_value" });
  localResolveReconciliation(rec.id, { line: 3, action: "ignore" });
  localResolveReconciliation(rec.id, { tx_id: "e", action: "keep" });
  expect(() => localCompleteReconciliation(rec.id)).toThrow(/saldos/);
  const adj = localAdjustBalance("acc", { target_balance: 1, reason: "Conferi no banco", date: "2026-10-31", reconciliation_id: rec.id });
  expect(adj.new_balance).toBe(1);
  expect(readDb().transactions.find(t => t.id === adj.id)?.balance_adjustment).toBe(true);
  expect(localGetReconciliation(rec.id).finnos_closing_cents).toBe(100);
  expect(localCompleteReconciliation(rec.id).status).toBe("concluida");
});
