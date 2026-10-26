import { firebaseAuth } from "@/lib/firebase";
import { cachedFetch } from "@/lib/offline/accountCache";
import type { Transaction, TransactionInput } from "@/types/finnos";
import { ApiError, apiGet, apiPost, apiPut } from "@/lib/api";

const DB_NAME = "finnos-sync";
const DB_VERSION = 1;
const STORE = "operations";

export type OperationSource = "manual" | "ios_shortcut" | "bank_notification" | "import" | "system";
type OperationKind = "transaction.create" | "transaction.update";

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
  await transact<void>("readwrite", (store, resolve, reject) => {
    const req = store.put(op);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
  return op;
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
        } else if (op.entityId) {
          await apiPut<Transaction>(`/transactions/${op.entityId}`, op.payload, { "X-FINNOS-Operation-ID": op.id, "X-FINNOS-Source": op.source, "X-FINNOS-Base-Version": String(op.baseVersion ?? 1) });
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

export async function updateQueuedTransaction(id: string, payload: TransactionInput): Promise<void> {
  const op = await getSyncOperation(id);
  if (!op) throw new Error("Operação pendente não encontrada.");
  // A sent operation is immutable: changing its payload would violate server idempotency.
  if (op.attempts > 0) {
    throw new Error("Esta operação já foi enviada. Revise a sincronização antes de editar.");
  }
  await saveSyncOperation({ ...op, payload, status: "pending", lastError: undefined });
  window.dispatchEvent(new CustomEvent("finnos:sync-state"));
}
