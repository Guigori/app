import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  firebaseAuth: {} as object | null,
  firebaseConfigurationError: null as string | null,
  popup: vi.fn(), signOut: vi.fn(), exchange: vi.fn(), token: vi.fn(),
}));
vi.mock("firebase/auth", () => ({ signInWithPopup: mocks.popup, signOut: mocks.signOut }));
vi.mock("./firebase", () => ({
  get firebaseAuth() { return mocks.firebaseAuth; },
  get firebaseConfigurationError() { return mocks.firebaseConfigurationError; },
  googleProvider: {},
}));
vi.mock("./api", () => ({ apiPostWithBearer: mocks.exchange, ApiError: class extends Error {} }));
import { googleSessionError, openGoogleSession } from "./googleSession";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.firebaseAuth = {};
  mocks.firebaseConfigurationError = null;
  mocks.token.mockResolvedValue("test-id-token");
  mocks.popup.mockResolvedValue({ user: { getIdToken: mocks.token } });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.exchange.mockResolvedValue({ id: "test-uid" });
});

describe("Google → FINNOS server session", () => {
  it("exchanges the Firebase token at the exact backend endpoint", async () => {
    expect(await openGoogleSession()).toEqual({ id: "test-uid" });
    expect(mocks.exchange).toHaveBeenCalledWith("/auth/firebase-session", "test-id-token");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("rejects invalid configuration before opening the popup", async () => {
    mocks.firebaseAuth = null;
    mocks.firebaseConfigurationError = "VITE_FIREBASE_API_KEY inválida";
    await expect(openGoogleSession()).rejects.toThrow("VITE_FIREBASE_API_KEY inválida");
    expect(mocks.popup).not.toHaveBeenCalled();
  });
  it("does not call the backend if Google rejects the key", async () => {
    const error = { code: "auth/api-key-not-valid", message: "sensitive-provider-message" };
    mocks.popup.mockRejectedValue(error);
    await expect(openGoogleSession()).rejects.toBe(error);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(googleSessionError(error)).toContain("auth/api-key-not-valid");
    expect(googleSessionError(error)).not.toContain(error.message);
  });
  it("signs Firebase out when the server exchange fails", async () => {
    const error = new Error("server exchange failed");
    mocks.exchange.mockRejectedValue(error);
    await expect(openGoogleSession()).rejects.toBe(error);
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.firebaseAuth);
  });
  it("preserves the exchange error even if cleanup fails", async () => {
    const error = new Error("original error");
    mocks.exchange.mockRejectedValue(error);
    mocks.signOut.mockRejectedValue(new Error("cleanup failed"));
    await expect(openGoogleSession()).rejects.toBe(error);
  });
  it("explains unauthorized preview domains", () => {
    expect(googleSessionError({ code: "auth/unauthorized-domain" })).toContain("domínio de preview");
  });
});
