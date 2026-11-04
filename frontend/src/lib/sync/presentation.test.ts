import { describe, expect, it } from "vitest";
import { describeSyncQueue } from "./presentation";
import type { SyncOperation } from "./queue";

function op(kind: SyncOperation["kind"], status: SyncOperation["status"] = "pending"): SyncOperation {
  return {
    id: crypto.randomUUID(),
    uid: "A",
    kind,
    payload: {} as SyncOperation["payload"],
    source: "manual",
    createdAt: "2026-10-27T12:00:00.000Z",
    attempts: 0,
    status,
  };
}

describe("offline queue presentation", () => {
  it("keeps standalone drafts distinct from money movements and server-acknowledged data", () => {
    const state = describeSyncQueue([op("account.create"), op("card.create")], "offline", false);
    expect(state.text).toContain("2 cadastros pendentes");
    expect(state.text).toContain("sem confirmação no servidor");
    expect(state.text).not.toContain("lançamentos");
    expect(state.blocker).toBeNull();
  });

  it("distinguishes pending transactions and drafts when syncing a mixed FIFO queue", () => {
    const state = describeSyncQueue(
      [op("transaction.create"), op("category.create"), op("subscription.create")],
      "online",
      true,
    );
    expect(state.text).toBe("Sincronizando 1 lançamento e 2 cadastros…");
  });

  it("puts rejected entity drafts ahead of a misleading spinner and uses the correct review label", () => {
    const rejected = op("subscription.create", "conflict");
    const state = describeSyncQueue([rejected, op("transaction.update")], "online", true);
    expect(state.blocker?.id).toBe(rejected.id);
    expect(state.ariaLabel).toContain("Revisar cadastro de assinatura");
    expect(state.text).toContain("1 lançamento e 1 cadastro na fila");
    expect(state.text).not.toContain("Sincronizando");
  });

  it("preserves transaction review routing and detects queues with no pending work", () => {
    expect(describeSyncQueue([op("transaction.delete", "conflict")], "online", false).ariaLabel)
      .toContain("Revisar lançamento");
    expect(describeSyncQueue([], "online", false).text).toBe("Tudo sincronizado");
    expect(describeSyncQueue([], "offline", false).text).toContain("Você está offline");
  });

  it("does not claim a temporarily failed draft has been saved remotely", () => {
    const state = describeSyncQueue([op("category.create", "error")], "online", false);
    expect(state.text).toBe("1 cadastro aguardando sincronização com o servidor");
  });
});
