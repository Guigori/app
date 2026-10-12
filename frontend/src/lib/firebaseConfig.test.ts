import { describe, expect, it } from "vitest";
import { readFirebaseConfig } from "./firebaseConfig";

const env = {
  VITE_FIREBASE_API_KEY: `AIza${"x".repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: "preview-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "preview-test",
  VITE_FIREBASE_APP_ID: "1:123:web:test",
};

describe("Firebase environment configuration", () => {
  it("accepts a complete Web config", () => {
    expect(readFirebaseConfig(env).error).toBeNull();
  });
  it("trims accidental surrounding whitespace", () => {
    const result = readFirebaseConfig({ ...env, VITE_FIREBASE_API_KEY: ` ${env.VITE_FIREBASE_API_KEY}\n` });
    expect(result.error).toBeNull();
    expect(result.config.apiKey).toBe(env.VITE_FIREBASE_API_KEY);
  });
  it.each(["VITE_FIREBASE_API_KEY=AIza_example", '"AIza_example"', "AIza_truncated", "undefined"])(
    "rejects malformed literal values without revealing the key (%s)", (value) => {
      const result = readFirebaseConfig({ ...env, VITE_FIREBASE_API_KEY: value });
      expect(result.error).toContain("VITE_FIREBASE_API_KEY inválida");
      expect(result.error).not.toContain(value);
    },
  );
  it("names missing configuration variables", () => {
    expect(readFirebaseConfig({}).error).toContain("VITE_FIREBASE_API_KEY");
  });
  it("rejects a URL used in place of the auth domain", () => {
    expect(readFirebaseConfig({ ...env, VITE_FIREBASE_AUTH_DOMAIN: "https://preview-test.firebaseapp.com/" }).error)
      .toContain("VITE_FIREBASE_AUTH_DOMAIN inválido");
  });
});
