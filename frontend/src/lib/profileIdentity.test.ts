import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { currentUser: null as { uid: string } | null, authStateReady: vi.fn() }, get: vi.fn(), cache: vi.fn() }));
vi.mock("./firebase", () => ({ firebaseAuth: mocks.auth }));
vi.mock("./api", () => ({
  apiGet: mocks.get,
  ApiError: class ApiError extends Error { status: number; constructor(status: number) { super("request failed"); this.status = status; } },
}));
vi.mock("./offline/accountCache", () => ({ cachedFetch: (_: string, online: () => Promise<unknown>) => mocks.cache(online) }));
import { ApiError } from "./api";
import { getMode, enableDemoMode, enableLocalMode } from "./mode";
import { loadSessionProfile, authenticationLabel } from "./profileIdentity";
const cloud = { id: "founder", name: "Founder real", email: "founder@example.test", created_at: "2026-10-12", auth_provider: "google.com" };
let storage: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.currentUser = null; mocks.auth.authStateReady.mockResolvedValue(undefined);
  mocks.cache.mockImplementation((online: () => Promise<unknown>) => online());
  storage = new Map([["finnos:local-db", "personal-finances-preserved"], ["finnos:demo-db", "old-demo-finances-preserved"]]);
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) } });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());
const local = () => ({ id: "local", name: "Demonstração", email: "conta local", created_at: "2026-10-12", session_mode: "demo" as const });

test("restored Firebase identity wins over old demo flag before any local profile is read", async () => {
  enableDemoMode(); mocks.auth.authStateReady.mockImplementation(async () => { mocks.auth.currentUser = { uid: "founder" }; });
  mocks.get.mockResolvedValue(cloud); const localRead = vi.fn(local);
  expect(await loadSessionProfile(localRead)).toMatchObject({ ...cloud, session_mode: "account" });
  expect(localRead).not.toHaveBeenCalled(); expect(getMode()).toBe("account");
  expect(storage.get("finnos:local-db")).toBe("personal-finances-preserved");
  expect(storage.get("finnos:demo-db")).toBe("old-demo-finances-preserved");
});
test("verified backend cookie wins over a device flag even when SDK user is missing", async () => {
  enableLocalMode(); mocks.get.mockResolvedValue(cloud); const localRead = vi.fn(local);
  expect((await loadSessionProfile(localRead)).id).toBe("founder"); expect(localRead).not.toHaveBeenCalled(); expect(getMode()).toBe("account");
});
test("explicit local profile is preserved only after backend confirms no session", async () => {
  enableDemoMode(); mocks.get.mockRejectedValue(new ApiError(401, null));
  expect(await loadSessionProfile(local)).toEqual(local()); expect(getMode()).toBe("demo");
});
test("Firebase authentication failure does not fall back to local financial identity", async () => {
  enableDemoMode(); mocks.auth.currentUser = { uid: "founder" }; mocks.get.mockRejectedValue(new ApiError(401, null)); const localRead = vi.fn(local);
  await expect(loadSessionProfile(localRead)).rejects.toHaveProperty("status",401); expect(localRead).not.toHaveBeenCalled();
});
test("backend outage does not silently replace an account with a demonstration", async () => {
  enableLocalMode(); mocks.get.mockRejectedValue(new ApiError(503, null)); const localRead = vi.fn(local);
  await expect(loadSessionProfile(localRead)).rejects.toHaveProperty("status",503); expect(localRead).not.toHaveBeenCalled();
});
test("explicit local profile remains usable offline without a Firebase identity", async () => {
  enableLocalMode(); vi.stubGlobal("navigator", { onLine: false }); expect(await loadSessionProfile(local)).toEqual(local()); expect(mocks.get).not.toHaveBeenCalled();
});
test("different backend UID is rejected before storing the profile", async () => {
  mocks.auth.currentUser = { uid: "other" }; mocks.get.mockResolvedValue(cloud);
  await expect(loadSessionProfile(local)).rejects.toThrow("FINNOS_SESSION_CHANGED");
});
test("cached identity from another UID is rejected offline", async () => {
  mocks.auth.currentUser = { uid: "other" }; mocks.cache.mockResolvedValue(cloud); vi.stubGlobal("navigator", { onLine: false });
  await expect(loadSessionProfile(local)).rejects.toThrow("FINNOS_SESSION_CHANGED");
});
test("profile labels distinguish Firebase providers from local and demo identities", () => {
  expect(authenticationLabel(cloud)).toBe("Firebase Authentication · Google");
  expect(authenticationLabel({ ...cloud, auth_provider: "password" })).toContain("E-mail e senha");
  expect(authenticationLabel(local())).toContain("Demonstração local");
});
