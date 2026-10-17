import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), mode: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet: mocks.get, apiPost: mocks.post, apiPatch: mocks.patch,
}));
vi.mock("@/lib/mode", () => ({ getMode: mocks.mode }));
import { destinationAfterAuthentication, emptyOnboarding, fetchOnboarding, saveOnboarding, startOnboarding } from "./onboarding";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode.mockReturnValue("account");
  mocks.get.mockResolvedValue(emptyOnboarding);
  mocks.post.mockResolvedValue({ ...emptyOnboarding, status: "in_progress" });
  mocks.patch.mockResolvedValue({ ...emptyOnboarding, status: "in_progress", step: 2 });
});

describe("onboarding state boundary", () => {
  it("queries the authenticated backend, not global localStorage", async () => {
    await expect(fetchOnboarding()).resolves.toEqual(emptyOnboarding);
    expect(mocks.get).toHaveBeenCalledWith("/onboarding");
  });
  it("starts onboarding explicitly for a new account", async () => {
    expect(await destinationAfterAuthentication(true)).toBe("/");
    expect(mocks.post).toHaveBeenCalledWith("/onboarding/start");
    expect(mocks.get).toHaveBeenCalledWith("/onboarding");
  });
  it("routes unfinished users into the wizard", async () => {
    mocks.get.mockResolvedValueOnce({ ...emptyOnboarding, status: "in_progress", step: 3 });
    expect(await destinationAfterAuthentication()).toBe("/onboarding");
  });
  it("keeps legacy and completed accounts on the Home", async () => {
    expect(await destinationAfterAuthentication()).toBe("/");
    mocks.get.mockResolvedValueOnce({ ...emptyOnboarding, status: "completed" });
    expect(await destinationAfterAuthentication()).toBe("/");
  });
  it("sends only selected onboarding fields to the backend", async () => {
    await saveOnboarding({ status: "in_progress", step: 2 });
    expect(mocks.patch).toHaveBeenCalledWith("/onboarding", { status: "in_progress", step: 2 });
  });
  it("does not call the server in local mode", async () => {
    mocks.mode.mockReturnValue("local");
    expect(await fetchOnboarding()).toEqual(emptyOnboarding);
    await startOnboarding();
    await saveOnboarding({ step: 1 });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("never blocks a verified session when onboarding lookup temporarily fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("503"));
    expect(await destinationAfterAuthentication()).toBe("/");
  });
});
