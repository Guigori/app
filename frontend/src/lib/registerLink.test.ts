import { describe, expect, it } from "vitest";
import { readRegisterLink, registerLinkBase } from "./registerLink";

describe("links that open the register filled in", () => {
  it("reads a sentence from Apple Shortcuts", () => {
    expect(readRegisterLink("#texto=caf%C3%A9%203%2C80%20e%20uber%2014")).toEqual({ sentence: "café 3,80 e uber 14", source: "atalho" });
  });

  it("turns a Wallet purchase into a sentence the register understands", () => {
    expect(readRegisterLink("#valor=R%24%2012%2C50&nome=Padaria%20P%C3%A3o%20Quente&cartao=Nubank")).toEqual({ sentence: "Padaria Pão Quente 12,50 no Nubank", source: "applepay" });
    expect(readRegisterLink("#valor=-9.9")?.sentence).toBe("Compra 9.9");
  });

  it("ignores anything else", () => {
    expect(readRegisterLink("")).toBeNull();
    expect(readRegisterLink("#outra=coisa")).toBeNull();
  });

  it("keeps the data after # so it never reaches the server", () => {
    expect(registerLinkBase("https://finnos.vercel.app")).toBe("https://finnos.vercel.app/registro-inteligente#");
  });
});
