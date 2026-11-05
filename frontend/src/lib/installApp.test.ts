import { describe, expect, it } from "vitest";
import { installPlatform } from "./installApp";

describe("install offer", () => {
  it("tells Safari on iPhone apart from other iPhone browsers, Android and desktop", () => {
    expect(installPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1")).toBe("ios-safari");
    expect(installPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/131.0 Mobile/15E148 Safari/604.1")).toBe("ios-other");
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", 5)).toBe("ios-safari");
    expect(installPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("android");
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", 0)).toBe("other");
  });
});
