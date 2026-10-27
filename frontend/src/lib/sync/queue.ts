import { firebaseAuth } from "@/lib/firebase";
import { cachedFetch } from "@/lib/offline/accountCache";
import type { Transaction, TransactionInput } from "@/types/finnos";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";

const DB_NAME = "finnos-sync";
const DB_VERSION = 1;
const STORE = "operations";

export type OperationSource = "manual" | "ios_shortcut" | "bank_notification" | "import" | "system";
type OperationKind = "transaction.create" | "transaction.update" | "transaction.delete";

export interface SyncOperation {
  id: string;
  uid: string;
  kind: OperationKind;
  entityId?: string;
  baseVersion?: number;
  payload: TransactionInput;
  source: OperationSource;
  createdAt: string;
  attempts: number;
  status: "pending" | "syncing" | "error" | "conflict";
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    fn(tx.objectStore(STORE), (value) => { result = value; }, reject);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function persistNewOperation(op: SyncOperation): Promise<void> {
  await transact<void>("readwrite", (store, resolve, reject) => {
    // Always allocate a stable FIFO timestamp inside one IDB transaction.
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const latest = (req.result as SyncOperation[]).reduce(
        (max, row) => Math.max(max, Date.parse(row.createdAt) || 0), 0,
      );
      op.createdAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
      const put = store.put(op);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    };
  });
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
}

export async function queueTransaction(input: TransactionInput, source: OperationSource = "manual", entityId?: string): Promise<SyncOperation> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error("FINNOS_AUTH_REQUIRED");
  const op: SyncOperation = {
    uid,
    id: crypto.randomUUID(),
    kind: entityId ? "transaction.update" : "transaction.create",
    entityId,
    baseVersion: entityId ? (await cachedFetch(`transaction:${entityId}`, () => apiGet<Transaction>(`/transactions/${entityId}`))).version ?? 1 : undefined,
    payload: input,
    source,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  if (!op.uid || op.uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  await persistNewOperation(op);
  return op;
}

/** Queue a delete only if this UID owns a cached server version.
 * Without a local snapshot we cannot safely form an optimistic conditional
 * deletion; users must open the record online first.
 */
export async function queueTransactionDelete(entityId: string): Promise<SyncOperation> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error("FINNOS_AUTH_REQUIRED");
  const queued = await listSyncOperations();
  if (queued.some(item => item.entityId === entityId)) {
    throw new Error("Revise a alteração pendente antes de excluir este lançamento.");
  }
  const existing = await cachedFetch(`transaction:${entityId}`,
    () => apiGet<Transaction>(`/transactions/${encodeURIComponent(entityId)}`));
  if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (!Number.isInteger(existing.version) || (existing.version ?? 0) < 1) {
    throw new Error("Versão financeira não disponível para exclusão offline.");
  }
  const operation: SyncOperation = {
    uid, id: crypto.randomUUID(), kind: "transaction.delete",
    entityId, baseVersion: existing.version,
    // Snapshot provides intelligible name/value for review and is never sent
    // as the DELETE payload. Existing queue views retain their payload shape.
    payload: existing as unknown as TransactionInput,
    source: "manual", createdAt: new Date().toISOString(),
    attempts: 0, status: "pending",
  };
  await persistNewOperation(operation);
  return operation;
}

export async function listSyncOperations(): Promise<SyncOperation[]> {
  return transact<SyncOperation[]>("readonly", (store, resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as SyncOperation[]).filter(op => op.uid === firebaseAuth?.currentUser?.uid && Boolean(op.uid)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    req.onerror = () => reject(req.error);
  });
}

export async function saveSyncOperation(op: SyncOperation): Promise<void> {
  if (!op.uid || op.uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
  await transact<void>("readwrite", (store, resolve, reject) => {
    const req = store.put(op);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function remove(id: string): Promise<void> {
  await transact<void>("readwrite", (store, resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let flushing = false;
export async function flushSyncQueue(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
  try {
    for (const op of await listSyncOperations()) {
      // FIFO is a financial invariant: a later update may depend on the prior
      // create/update. Never skip a rejected operation and send its successors.
      // Conflicts and validation errors require explicit resolution.
      if (op.status === "conflict") break;
      if (!navigator.onLine || op.uid !== firebaseAuth?.currentUser?.uid) break;
      const current = { ...op, status: "syncing" as const, attempts: op.attempts + 1, lastError: undefined };
      await saveSyncOperation(current);
      window.dispatchEvent(new CustomEvent("finnos:sync-state"));
      try {
        if (op.kind === "transaction.create") {
          await apiPost<Transaction>("/transactions", op.payload, { "X-FINNOS-Operation-ID": op.id, "X-FINNOS-Source": op.source });
        } else if (op.kind === "transaction.delete" && op.entityId) {
          await apiDelete<void>(`/transactions/${encodeURIComponent(op.entityId)}`, {
            "X-FINNOS-Operation-ID": op.id,
            "X-FINNOS-Base-Version": String(op.baseVersion ?? 1),
          });
        } else if (op.kind === "transaction.update" && op.entityId) {
          await apiPut<Transaction>(`/transactions/${encodeURIComponent(op.entityId)}`, op.payload, { "X-FINNOS-Operation-ID": op.id, "X-FINNOS-Source": op.source, "X-FINNOS-Base-Version": String(op.baseVersion ?? 1) });
        } else {
          throw new Error("Operação financeira offline desconhecida.");
        }
        // A completed request may have committed on the server while the user
        // changed accounts. Preserve the operation for an idempotent retry by
        // the original UID rather than silently deleting its queue record.
        if (op.uid !== firebaseAuth?.currentUser?.uid) break;
        await remove(op.id);
        window.dispatchEvent(new CustomEvent("finnos:sync-success", { detail: { operation: op } }));
      } catch (error) {
        // 409 conflicts and 422 payload rejections cannot be repaired by
        // replaying the same operation. Keep them for manual review.
        const needsReview = error instanceof ApiError && (error.status === 409 || error.status === 422);
        const failed = {
          ...current,
          status: (needsReview ? "conflict" : "error") as "conflict" | "error",
          lastError: error instanceof Error ? error.message : "Falha ao sincronizar",
        };
        // Do not modify a former user's queue after switching accounts.
        if (op.uid !== firebaseAuth?.currentUser?.uid) break;
        await saveSyncOperation(failed);
        window.dispatchEvent(new CustomEvent("finnos:sync-error", { detail: { operation: failed } }));
        // Stop on *any* failure. This preserves dependency order, including
        // the next flush; only an explicit resolution can bypass a conflict.
        break;
      }
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new CustomEvent("finnos:sync-state"));
  }
}

export async function syncQueueCount(): Promise<number> {
  return (await listSyncOperations()).length;
}


export async function getSyncOperation(id: string): Promise<SyncOperation | null> {
  return transact<SyncOperation | null>("readonly", (store, resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result?.uid === firebaseAuth?.currentUser?.uid ? (req.result as SyncOperation) : null);
    req.onerror = () => reject(req.error);
  });
}

/** Explicit conflict resolution after the user has reconciled server state.
 * Never delete an operation that could still be retryable or is being sent.
 * The UI must clearly warn that an unsent local record may be lost.
 */
export async function discardConflictedOperation(id: string): Promise<void> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error("FINNOS_AUTH_REQUIRED");
  const reviewed = await getSyncOperation(id);
  if (!reviewed || reviewed.uid !== uid) throw new Error("FINNOS_SESSION_CHANGED");
  if (reviewed.status !== "conflict") {
    throw new Error("Somente operações bloqueadas podem ser descartadas após revisão.");
  }
  await transact<void>("readwrite", (store, resolve, reject) => {
    const req = store.get(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const op = req.result as SyncOperation | undefined;
      if (!op || op.uid !== uid || firebaseAuth?.currentUser?.uid !== uid) {
        reject(new Error("FINNOS_SESSION_CHANGED"));
        return;
      }
      if (op.status !== "conflict") {
        reject(new Error("Somente operações bloqueadas podem ser descartadas após revisão."));
        return;
      }
      const deleted = store.delete(id);
      deleted.onsuccess = () => resolve();
      deleted.onerror = () => reject(deleted.error);
    };
  });
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
}

export async function updateQueuedTransaction(id: string, payload: TransactionInput): Promise<void> {
  const op = await getSyncOperation(id);
  if (!op) throw new Error("Operação pendente não encontrada.");
  if (op.kind === "transaction.delete") throw new Error("Exclusão pendente não pode ser editada.");
  // A sent operation is immutable: changing its payload would violate server idempotency.
  if (op.attempts > 0) {
    throw new Error("Esta operação já foi enviada. Revise a sincronização antes de editar.");
  }
  await saveSyncOperation({ ...op, payload, status: "pending", lastError: undefined });
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
}
