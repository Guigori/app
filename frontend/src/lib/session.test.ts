import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), clear: vi.fn(), cache: vi.fn() }));
vi.mock("./api", () => ({ apiPost: mocks.post }));
vi.mock("./queryClient", () => ({ queryClient: { clear: mocks.clear } }));
vi.mock("./offline/accountCache", () => ({ clearAccountCache: mocks.cache }));
vi.mock("./firebase", () => ({ firebaseAuth: null }));
vi.mock("firebase/auth", () => ({ signOut: vi.fn() }));
import { endSession, endSessionForDeviceMode } from "./session";

beforeEach(() => { vi.clearAllMocks(); mocks.cache.mockResolvedValue(undefined); });

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
