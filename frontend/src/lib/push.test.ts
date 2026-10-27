import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  permission: vi.fn(),
  register: vi.fn(),
  subscription: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiDelete: mocks.del,
}));

import { enablePush, pushServerAvailable } from "./push";

beforeEach(() => {
  vi.clearAllMocks();
  const registration = {
    pushManager: { getSubscription: mocks.subscription, subscribe: vi.fn() },
  };
  mocks.register.mockResolvedValue(registration);
  mocks.subscription.mockResolvedValue({
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: "public-key", auth: "auth-key" },
    }),
  });
  mocks.permission.mockResolvedValue("granted");
  mocks.post.mockResolvedValue(undefined);
  vi.stubGlobal("window", { PushManager: class PushManager {} });
  vi.stubGlobal("navigator", {
    serviceWorker: { register: mocks.register, ready: Promise.resolve(registration) },
  });
  vi.stubGlobal("Notification", { requestPermission: mocks.permission });
});

describe("WebPush enrolment", () => {
  it("does not request device permission or create a subscription when the server is disabled", async () => {
    mocks.get.mockResolvedValue({ public_key: "", supported: false });
    expect(await pushServerAvailable()).toBe(false);
    await expect(enablePush()).rejects.toThrow("não estão configurados");
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("only asks permission and subscribes after server readiness was confirmed", async () => {
    mocks.get.mockResolvedValue({ public_key: "valid-public-key", supported: true });
    expect(await pushServerAvailable()).toBe(true);
    await enablePush();
    expect(mocks.permission).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith("/sw.js");
    expect(mocks.post).toHaveBeenCalledWith("/push/subscribe", {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: "public-key", auth: "auth-key" },
    });
  });

  it("preserves browser permission refusal without registering a service worker", async () => {
    mocks.get.mockResolvedValue({ public_key: "valid-public-key", supported: true });
    mocks.permission.mockResolvedValue("denied");
    await expect(enablePush()).rejects.toThrow("Permissão de notificação");
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
