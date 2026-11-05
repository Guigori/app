import { describe, expect, it } from "vitest";
import { evaluateExpression, pressKey, typedDisplay } from "./registerKeypad";

const type = (keys: string[]) => keys.reduce(pressKey, "");

describe("evaluateExpression", () => {
  it("multiplies and divides before adding and subtracting", () => {
    expect(evaluateExpression("12,50+3×2")).toBe(18.5);
    expect(evaluateExpression("100−20÷4")).toBe(95);
  });
  it("ignores a trailing operator and guards division by zero", () => {
    expect(evaluateExpression("45+")).toBe(45);
    expect(evaluateExpression("10÷0")).toBe(0);
    expect(evaluateExpression("")).toBe(0);
  });
});

describe("pressKey", () => {
  it("builds numbers with one comma and two decimals", () => {
    expect(type(["1", "2", ",", "5", "0", "9"])).toBe("12,50");
    expect(type([",", "5"])).toBe("0,5");
    expect(type(["0", "7"])).toBe("7");
  });
  it("replaces a repeated operator and never starts with one", () => {
    expect(type(["+", "4", "+", "×", "2"])).toBe("4×2");
  });
  it("deletes the last key", () => {
    expect(type(["4", "5", "⌫"])).toBe("4");
  });
});

describe("typedDisplay", () => {
  it("keeps the comma being typed", () => {
    expect(typedDisplay("1234,")).toBe("R$ 1.234,");
    expect(typedDisplay("12+3")).toBeNull();
  });
});
