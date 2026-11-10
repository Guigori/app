import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ currentUser: null as { uid: string } | null, authStateReady: vi.fn(async () => undefined) }));
const cache = vi.hoisted(() => ({ get: vi.fn() }));
const mode = vi.hoisted(() => ({ local: false }));
vi.mock("./firebase", () => ({ firebaseAuth: auth }));
vi.mock("./api", () => ({ apiGet: vi.fn(), ApiError: class extends Error {} }));
vi.mock("./mode", () => ({ disableLocalMode: vi.fn(), isLocalMode: () => mode.local }));
vi.mock("./offline/accountCache", () => ({ cacheGet: cache.get, cachedFetch: vi.fn() }));

const { cachedSessionProfile } = await import("./profileIdentity");

beforeEach(() => {
  auth.currentUser = { uid: "igor" };
  mode.local = false;
  cache.get.mockReset();
});

describe("opening the app with the saved session", () => {
  it("uses the profile saved for the Firebase user signed in on this iPhone", async () => {
    cache.get.mockResolvedValue({ id: "igor", name: "Igor", email: "i@x.com" });
    await expect(cachedSessionProfile()).resolves.toMatchObject({ id: "igor", name: "Igor", session_mode: "account" });
    expect(cache.get).toHaveBeenCalledWith("firebase:igor:me");
  });

  it("never opens with someone else's profile, with nobody signed in, or in local mode", async () => {
    cache.get.mockResolvedValue({ id: "outra-pessoa", name: "X" });
    await expect(cachedSessionProfile()).resolves.toBeNull();
    auth.currentUser = null;
    await expect(cachedSessionProfile()).resolves.toBeNull();
    auth.currentUser = { uid: "igor" };
    mode.local = true;
    await expect(cachedSessionProfile()).resolves.toBeNull();
  });

  it("waits for the server when nothing was saved or the cache cannot be read", async () => {
    cache.get.mockResolvedValue(null);
    await expect(cachedSessionProfile()).resolves.toBeNull();
    cache.get.mockRejectedValue(new Error("indexeddb blocked"));
    await expect(cachedSessionProfile()).resolves.toBeNull();
  });
});
