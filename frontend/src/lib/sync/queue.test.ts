import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
const mocks=vi.hoisted(()=>({auth:{currentUser:{uid:"A"} as {uid:string}|null},post:vi.fn(),put:vi.fn()}));
vi.mock("@/lib/firebase",()=>({firebaseAuth:mocks.auth}));
vi.mock("@/lib/api",()=>({ApiError: class ApiError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} },apiPost:mocks.post,apiPut:mocks.put,apiGet:vi.fn()}));
import { cacheSet,cachedFetch } from "@/lib/offline/accountCache";
import { queueTransaction,listSyncOperations,flushSyncQueue } from "./queue";
const input={name:"Offline",type:"despesa" as const,status:"pago" as const,value:12.34,date:"2026-10-12",account_id:"bank",card_id:null,to_account_id:null,category_id:null,fixed:false,recurrence:null,installment:false,total_installments:null,current_installment:null,adjusted_value:null,attachment:null,notes:null,notify_enabled:true};
beforeEach(()=>{vi.stubGlobal("indexedDB",new IDBFactory());vi.stubGlobal("navigator",{onLine:false});vi.stubGlobal("window",{dispatchEvent:vi.fn()});mocks.auth.currentUser={uid:"A"};mocks.post.mockReset();mocks.put.mockReset();});
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
