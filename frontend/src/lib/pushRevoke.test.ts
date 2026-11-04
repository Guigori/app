import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: mocks.del }));
import { revokePushForSession } from "./push";

afterEach(() => { vi.unstubAllGlobals(); mocks.del.mockReset(); });

function device(subscription: { endpoint: string; unsubscribe: () => Promise<boolean> } | null, ready = new Promise(() => undefined)) {
  vi.stubGlobal("window", { PushManager: class {} });
  vi.stubGlobal("navigator", { serviceWorker: { ready, getRegistration: async () => subscription ? { pushManager: { getSubscription: async () => subscription } } : undefined } });
}

it("AUD-12: unsubscribes the device even when the server delete fails offline", async () => {
  const unsubscribe = vi.fn(async () => true);
  device({ endpoint: "https://push.example.test/synthetic", unsubscribe });
  mocks.del.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(revokePushForSession()).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalled();
});

it("never waits for a service worker that was never registered", async () => {
  device(null); // serviceWorker.ready never resolves here
  await expect(revokePushForSession()).resolves.toBeUndefined();
  expect(mocks.del).not.toHaveBeenCalled();
});
