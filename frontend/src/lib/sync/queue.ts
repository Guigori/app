import type { Transaction, TransactionInput } from "@/types/finnos";
import { apiPost, apiPut } from "@/lib/api";

const DB_NAME = "finnos-sync";
const DB_VERSION = 1;
const STORE = "operations";

export type OperationSource = "manual" | "ios_shortcut" | "bank_notification" | "import" | "system";
type OperationKind = "transaction.create" | "transaction.update";

export interface SyncOperation {
  id: string;
  kind: OperationKind;
  entityId?: string;
  payload: TransactionInput;
  source: OperationSource;
  createdAt: string;
  attempts: number;
  status: "pending" | "syncing" | "error";
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
    fn(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function queueTransaction(input: TransactionInput, source: OperationSource = "manual", entityId?: string): Promise<SyncOperation> {
  const op: SyncOperation = {
    id: crypto.randomUUID(),
    kind: entityId ? "transaction.update" : "transaction.create",
    entityId,
    payload: input,
    source,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
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
    req.onsuccess = () => resolve((req.result as SyncOperation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    req.onerror = () => reject(req.error);
  });
}

async function save(op: SyncOperation): Promise<void> {
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
      if (!navigator.onLine) break;
      const current = { ...op, status: "syncing" as const, attempts: op.attempts + 1, lastError: undefined };
      await save(current);
      window.dispatchEvent(new CustomEvent("finnos:sync-state"));
      try {
        if (op.kind === "transaction.create") {
          await apiPost<Transaction>("/transactions", op.payload, { "X-FINNOS-Operation-ID": op.id, "X-FINNOS-Source": op.source });
        } else if (op.entityId) {
          await apiPut<Transaction>(`/transactions/${op.entityId}`, op.payload, { "X-FINNOS-Operation-ID": op.id, "X-FINNOS-Source": op.source });
        }
        await remove(op.id);
      } catch (error) {
        await save({ ...current, status: "error", lastError: error instanceof Error ? error.message : "Falha ao sincronizar" });
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
