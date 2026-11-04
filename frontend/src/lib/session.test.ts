import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), clear: vi.fn(), cache: vi.fn(), revoke: vi.fn(), order: [] as string[] }));
vi.mock("./api", () => ({ apiPost: mocks.post }));
vi.mock("./queryClient", () => ({ queryClient: { clear: mocks.clear } }));
vi.mock("./offline/accountCache", () => ({ clearAccountCache: mocks.cache }));
vi.mock("./push", () => ({ revokePushForSession: mocks.revoke }));
vi.mock("./firebase", () => ({ firebaseAuth: null }));
vi.mock("firebase/auth", () => ({ signOut: vi.fn() }));
import { endSession, endSessionForDeviceMode } from "./session";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.cache.mockResolvedValue(undefined);
  mocks.revoke.mockImplementation(async () => { mocks.order.push("revoke"); });
  mocks.post.mockImplementation(async () => { mocks.order.push("logout"); });
});

it("still reports a failed server logout on a regular sign-out", async () => {
  mocks.post.mockRejectedValueOnce(new Error("request failed with 502"));
  await expect(endSession()).rejects.toThrow("502");
  expect(mocks.clear).toHaveBeenCalled();
});

it("enters local or demo mode when the server is unreachable, after clearing the cache", async () => {
  mocks.post.mockRejectedValueOnce(new Error("request failed with 502"));
  await expect(endSessionForDeviceMode()).resolves.toBeUndefined();
  expect(mocks.clear).toHaveBeenCalled();
  expect(mocks.cache).toHaveBeenCalled();
});

it("AUD-12: revokes this device's push enrolment before the server session ends", async () => {
  await endSession();
  expect(mocks.order).toEqual(["revoke", "logout"]);
});
