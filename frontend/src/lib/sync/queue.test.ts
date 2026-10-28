import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
const mocks=vi.hoisted(()=>({auth:{currentUser:{uid:"A"} as {uid:string}|null},post:vi.fn(),put:vi.fn(),del:vi.fn()}));
vi.mock("@/lib/firebase",()=>({firebaseAuth:mocks.auth}));
vi.mock("@/lib/api",()=>({ApiError: class ApiError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} },apiPost:mocks.post,apiPut:mocks.put,apiDelete:mocks.del,apiGet:vi.fn()}));
import { cacheSet,cachedFetch } from "@/lib/offline/accountCache";
import { queueTransaction,queueTransactionDelete,queueEntityCreate,listSyncOperations,flushSyncQueue,discardConflictedOperation } from "./queue";
const input={name:"Offline",type:"despesa" as const,status:"pago" as const,value:12.34,date:"2026-10-12",account_id:"bank",card_id:null,to_account_id:null,category_id:null,fixed:false,recurrence:null,installment:false,total_installments:null,current_installment:null,adjusted_value:null,attachment:null,notes:null,notify_enabled:true};
beforeEach(()=>{vi.stubGlobal("indexedDB",new IDBFactory());vi.stubGlobal("navigator",{onLine:false});vi.stubGlobal("window",{dispatchEvent:vi.fn()});mocks.auth.currentUser={uid:"A"};mocks.post.mockReset();mocks.put.mockReset();mocks.del.mockReset();});
it("commits the offline queue to IndexedDB and isolates user switches",async()=>{
  await queueTransaction(input);
  expect(await listSyncOperations()).toHaveLength(1);
  mocks.auth.currentUser={uid:"B"};expect(await listSyncOperations()).toEqual([]);
  vi.stubGlobal("navigator",{onLine:true});await flushSyncQueue();expect(mocks.post).not.toHaveBeenCalled();
  mocks.auth.currentUser={uid:"A"};mocks.post.mockResolvedValue({id:"server"});await flushSyncQueue();
  expect(mocks.post.mock.calls[0][2]["X-FINNOS-Operation-ID"]).toBeTruthy();expect(await listSyncOperations()).toEqual([]);
});
it("reuses the same operation after a lost response and removes it only after success",async()=>{
  const operation=await queueTransaction(input);
  vi.stubGlobal("navigator",{onLine:true});mocks.post.mockRejectedValueOnce(new Error("connection lost"));
  await flushSyncQueue();expect((await listSyncOperations())[0].status).toBe("error");
  mocks.post.mockResolvedValue({id:"same-server-id"});await flushSyncQueue();
  expect(mocks.post.mock.calls.map(c=>c[2]["X-FINNOS-Operation-ID"])).toEqual([operation.id,operation.id]);expect(await listSyncOperations()).toEqual([]);
});
it("sends the cached base version and keeps conflicting edits for review",async()=>{
  await cacheSet("firebase:A:transaction:existing",{id:"existing",version:4});
  await queueTransaction(input,"manual","existing");
  const { ApiError } = await import("@/lib/api");
  vi.stubGlobal("navigator",{onLine:true});mocks.put.mockRejectedValue(new ApiError(409,"409 conflict"));
  await flushSyncQueue();expect(mocks.put.mock.calls[0][2]["X-FINNOS-Base-Version"]).toBe("4");
  expect((await listSyncOperations())[0].lastError).toBe("409 conflict");
  expect((await listSyncOperations())[0].status).toBe("conflict");
});
it("does not share an IndexedDB financial snapshot with another UID",async()=>{
  vi.stubGlobal("navigator",{onLine:true});await cachedFetch("accounts",async()=>[{name:"A"}]);
  vi.stubGlobal("navigator",{onLine:false});expect(await cachedFetch("accounts",vi.fn())).toEqual([{name:"A"}]);
  mocks.auth.currentUser={uid:"B"};await expect(cachedFetch("accounts",vi.fn())).rejects.toThrow("FINNOS_OFFLINE_NO_CACHE");
});


it("commits an offline React Query mutation durably instead of pausing it in memory", async () => {
  const { MutationObserver, onlineManager } = await import("@tanstack/react-query");
  const { queryClient } = await import("@/lib/queryClient");
  onlineManager.setOnline(false);
  try {
    const observer = new MutationObserver(queryClient, { mutationFn: () => queueTransaction(input) });
    const operation = await observer.mutate();
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect((await listSyncOperations())[0].id).toBe(operation.id);
    let reads = 0;
    await queryClient.fetchQuery({ queryKey: ["offline-real-cache-reader"], queryFn: async () => { reads++; return "cached"; } });
    expect(reads).toBe(1);
  } finally {
    onlineManager.setOnline(true);
    queryClient.clear();
  }
});


it.each([409, 422])("blocks later queued financial operations after a %i rejection", async (status) => {
  const { ApiError } = await import("@/lib/api");
  const first = await queueTransaction({ ...input, name: "First" });
  const second = await queueTransaction({ ...input, name: "Second" });
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockRejectedValueOnce(new ApiError(status, "requires review"));
  await flushSyncQueue();
  const pending = await listSyncOperations();
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post.mock.calls[0][2]["X-FINNOS-Operation-ID"]).toBe(first.id);
  expect(pending.find(op => op.id === first.id)?.status).toBe("conflict");
  expect(pending.find(op => op.id === second.id)?.status).toBe("pending");

  // No automatic retry may silently bypass a rejected first operation.
  await flushSyncQueue();
  expect(mocks.post).toHaveBeenCalledTimes(1);
});

it("preserves FIFO and original idempotency keys when the first request fails temporarily", async () => {
  const first = await queueTransaction({ ...input, name: "First" });
  const second = await queueTransaction({ ...input, name: "Second" });
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockRejectedValueOnce(new Error("network disconnected"));
  await flushSyncQueue();
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect((await listSyncOperations()).find(op => op.id === second.id)?.attempts).toBe(0);

  mocks.post.mockResolvedValue({ id: "created" });
  await flushSyncQueue();
  expect(mocks.post.mock.calls.map(call => call[2]["X-FINNOS-Operation-ID"]))
    .toEqual([first.id, first.id, second.id]);
  expect(await listSyncOperations()).toHaveLength(0);
});

it("does not remove a queued operation after an account switch during a successful response", async () => {
  const queued = await queueTransaction({ ...input, name: "Switch" });
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockImplementationOnce(async () => {
    mocks.auth.currentUser = { uid: "B" };
    return { id: "server-commit" };
  });
  await flushSyncQueue();
  expect(await listSyncOperations()).toEqual([]);
  mocks.auth.currentUser = { uid: "A" };
  const pending = await listSyncOperations();
  expect(pending).toHaveLength(1);
  expect(pending[0].id).toBe(queued.id);
  expect(pending[0].status).toBe("syncing");

  mocks.post.mockResolvedValue({ id: "server-commit" });
  await flushSyncQueue();
  expect(mocks.post.mock.calls.map(call => call[2]["X-FINNOS-Operation-ID"]))
    .toEqual([queued.id, queued.id]);
  expect(await listSyncOperations()).toHaveLength(0);
});


it("only an explicit UID-scoped reviewed discard unblocks a failed operation", async () => {
  const { ApiError } = await import("@/lib/api");
  const first = await queueTransaction({ ...input, name: "Rejected" });
  const second = await queueTransaction({ ...input, name: "Later" });
  await expect(discardConflictedOperation(first.id)).rejects.toThrow("Somente operações bloqueadas");
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockRejectedValueOnce(new ApiError(422, "invalid category"));
  await flushSyncQueue();
  expect(mocks.post).toHaveBeenCalledTimes(1);

  mocks.auth.currentUser = { uid: "B" };
  await expect(discardConflictedOperation(first.id)).rejects.toThrow("FINNOS_SESSION_CHANGED");
  expect(await listSyncOperations()).toHaveLength(0);
  mocks.auth.currentUser = { uid: "A" };
  expect(await listSyncOperations()).toHaveLength(2);

  await discardConflictedOperation(first.id);
  expect((await listSyncOperations()).map(op => op.id)).toEqual([second.id]);
  mocks.post.mockResolvedValue({ id: "later-ok" });
  await flushSyncQueue();
  expect(mocks.post.mock.calls.map(call => call[2]["X-FINNOS-Operation-ID"]))
    .toEqual([first.id, second.id]);
  expect(await listSyncOperations()).toHaveLength(0);
});


it("queues a bank transaction delete with a cached version and replays one idempotent DELETE", async () => {
  await cacheSet("firebase:A:transaction:existing", { ...input, id: "existing", version: 4 });
  const operation = await queueTransactionDelete("existing");
  expect(operation.kind).toBe("transaction.delete");
  expect(operation.baseVersion).toBe(4);
  expect((await listSyncOperations()).map(item => item.id)).toEqual([operation.id]);
  vi.stubGlobal("navigator", { onLine: true });
  mocks.del.mockRejectedValueOnce(new Error("response lost"));
  await flushSyncQueue();
  expect((await listSyncOperations())[0].status).toBe("error");
  mocks.del.mockResolvedValue(undefined);
  await flushSyncQueue();
  expect(mocks.del.mock.calls).toEqual([
    ["/transactions/existing", {
      "X-FINNOS-Operation-ID": operation.id, "X-FINNOS-Base-Version": "4",
    }],
    ["/transactions/existing", {
      "X-FINNOS-Operation-ID": operation.id, "X-FINNOS-Base-Version": "4",
    }],
  ]);
  expect(await listSyncOperations()).toEqual([]);
});

it("never retries a conflicted offline deletion or leaks it to another account", async () => {
  const { ApiError } = await import("@/lib/api");
  await cacheSet("firebase:A:transaction:existing", { ...input, id: "existing", version: 7 });
  const removed = await queueTransactionDelete("existing");
  const next = await queueTransaction({ ...input, name: "After delete" });
  vi.stubGlobal("navigator", { onLine: true });
  mocks.del.mockRejectedValueOnce(new ApiError(409, "version conflict"));
  await flushSyncQueue();
  expect((await listSyncOperations()).map(item => [item.id,item.status]))
    .toEqual([[removed.id,"conflict"],[next.id,"pending"]]);
  expect(mocks.post).not.toHaveBeenCalled();
  await flushSyncQueue();
  expect(mocks.del).toHaveBeenCalledTimes(1);
  mocks.auth.currentUser = {uid:"B"};
  expect(await listSyncOperations()).toEqual([]);
  mocks.auth.currentUser = {uid:"A"};
  await discardConflictedOperation(removed.id);
  mocks.post.mockResolvedValue({});
  await flushSyncQueue();
  expect(await listSyncOperations()).toHaveLength(0);
});

it("rejects offline deletion without a previously verified version", async () => {
  await expect(queueTransactionDelete("uncached")).rejects.toThrow("FINNOS_OFFLINE_NO_CACHE");
  expect(await listSyncOperations()).toEqual([]);
});


it.each([
  ["account.create", "/accounts", { name: "Banco", initial_balance: -200, type: "corrente", institution: "", institution_id: null, color: "#070F52", active: true }],
  ["category.create", "/categories", { name: "Alimentação", group: "necessidades", color: "#070F52", icon: "wallet", monthly_budget: 300, monthly_goal: 0 }],
  ["card.create", "/cards", { name: "Cartão", institution: "", institution_id: null, color: "#070F52", limit: 1000, closing_day: 10, due_day: 20, payment_account_id: "server-bank", active: true }],
  ["subscription.create", "/subscriptions", { name: "Streaming", value: 49.9, recurrence: "mensal", next_charge: "2026-10-29", account_id: "server-bank", card_id: null, category_id: null, active: true, notes: null }],
] as const)("persists a %s draft and replays one idempotent server create", async (kind, path, payload) => {
  const op = await queueEntityCreate(kind, payload);
  expect((await listSyncOperations())[0].status).toBe("pending");
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockRejectedValueOnce(new Error("lost response"));
  await flushSyncQueue();
  expect((await listSyncOperations())[0].status).toBe("error");
  mocks.post.mockResolvedValue({ id: "deterministic-server-id" });
  await flushSyncQueue();
  expect(mocks.post.mock.calls).toEqual([
    [path, payload, { "X-FINNOS-Operation-ID": op.id }],
    [path, payload, { "X-FINNOS-Operation-ID": op.id }],
  ]);
  expect(await listSyncOperations()).toEqual([]);
});

it("blocks a rejected category draft and never sends the next account until resolved", async () => {
  const { ApiError } = await import("@/lib/api");
  const first = await queueEntityCreate("category.create", { name: "Teste", group: "desejos", monthly_budget: 0, monthly_goal: 0, color: "#070F52", icon: "wallet" });
  await queueEntityCreate("account.create", { name: "Banco", initial_balance: 0, institution: "", institution_id: null, type: "corrente", color: "#070F52", active: true });
  vi.stubGlobal("navigator", { onLine: true });
  mocks.post.mockRejectedValueOnce(new ApiError(422, "invalid category"));
  await flushSyncQueue();
  const rows = await listSyncOperations();
  expect(rows.map(op => op.status)).toEqual(["conflict", "pending"]);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  mocks.auth.currentUser = { uid: "B" };
  expect(await listSyncOperations()).toEqual([]);
  mocks.auth.currentUser = { uid: "A" };
  await discardConflictedOperation(first.id);
  mocks.post.mockResolvedValue({ id: "bank-created" });
  await flushSyncQueue();
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(await listSyncOperations()).toEqual([]);
});


it("replays conditional account/category/card/subscription edits and deletes in FIFO order", async () => {
  const { queueEntityMutation } = await import("./queue");
  const payload = {
    name: "Revisado", institution: "", type: "corrente" as const,
    color: "#070F52", initial_balance: 0, active: true,
  };
  const edit = await queueEntityMutation("account.update", "bank-2", payload, 3);
  const remove = await queueEntityMutation("category.delete", "category-4",
    { name: "Antiga", icon: "tag", color: "#64748B", group: "necessidades",
      monthly_budget: 0, monthly_goal: 0 }, 2);
  vi.stubGlobal("navigator", { onLine: true });
  mocks.put.mockResolvedValue({});
  mocks.del.mockResolvedValue(undefined);
  await flushSyncQueue();
  expect(mocks.put).toHaveBeenCalledWith("/accounts/bank-2", payload, {
    "X-FINNOS-Operation-ID": edit.id, "X-FINNOS-Base-Version": "3",
  });
  expect(mocks.del).toHaveBeenCalledWith("/categories/category-4", {
    "X-FINNOS-Operation-ID": remove.id, "X-FINNOS-Base-Version": "2",
  });
  expect(await listSyncOperations()).toEqual([]);
});

it("blocks stale offline entity mutations and isolates UID-scoped drafts", async () => {
  const { queueEntityMutation } = await import("./queue");
  const subscription = {
    name: "Plano", value: 19.90, recurrence: "mensal" as const,
    next_charge: "2026-11-01", account_id: "bank", category_id: null,
    card_id: null, active: true, notes: null,
  };
  await expect(queueEntityMutation("subscription.update", "plan", subscription, 0))
    .rejects.toThrow("Versão");
  const first = await queueEntityMutation("subscription.update", "plan", subscription, 1);
  await expect(queueEntityMutation("subscription.delete", "plan", subscription, 1))
    .rejects.toThrow("pendente");
  mocks.auth.currentUser = { uid: "B" };
  expect(await listSyncOperations()).toEqual([]);
  vi.stubGlobal("navigator", { onLine: true });
  await flushSyncQueue();
  expect(mocks.put).not.toHaveBeenCalled();
  mocks.auth.currentUser = { uid: "A" };
  const { ApiError } = await import("@/lib/api");
  mocks.put.mockRejectedValueOnce(new ApiError(409, "Conflito de versão"));
  await flushSyncQueue();
  expect((await listSyncOperations())[0].id).toBe(first.id);
  expect((await listSyncOperations())[0].status).toBe("conflict");
});
