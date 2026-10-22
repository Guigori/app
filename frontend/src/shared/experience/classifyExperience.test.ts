import { describe, expect, it } from "vitest";
import { classifyExperience } from "./classifyExperience";

describe("FINNOS presentation selection", () => {
  it("keeps phones in App in portrait and landscape", () => {
    expect(classifyExperience({ width: 390, height: 844, touch: true, coarsePointer: true })).toBe("app");
    expect(classifyExperience({ width: 844, height: 390, touch: true, coarsePointer: true })).toBe("app");
  });
  it("uses App for tablet portrait and Dashboard for landscape", () => {
    expect(classifyExperience({ width: 820, height: 1180, touch: true, coarsePointer: true })).toBe("app");
    expect(classifyExperience({ width: 1180, height: 820, touch: true, coarsePointer: true })).toBe("dashboard");
  });
  it("does not confuse desktop windows with phones", () => {
    expect(classifyExperience({ width: 500, height: 900, touch: false, coarsePointer: false })).toBe("dashboard");
  });
  it("does not confuse touch laptops with tablets when pointer is fine", () => {
    expect(classifyExperience({ width: 900, height: 1200, touch: true, coarsePointer: false })).toBe("dashboard");
  });
  it("supports iPadOS tablet hint at smaller split-screen sizes", () => {
    expect(classifyExperience({ width: 540, height: 720, touch: true, coarsePointer: true, tabletHint: true })).toBe("app");
  });
});
