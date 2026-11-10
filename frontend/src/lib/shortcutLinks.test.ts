import { describe, expect, it } from "vitest";
import { connectShortcutUrl, readyShortcutUrl, SHORTCUT_NAME, AUTOMATION_FIELDS, bearerValue, codeFromConnection, pendingEndpoint } from "@/lib/shortcutLinks";

describe("the ready-made shortcut", () => {
  it("is offered only for a real iCloud shortcut link", () => {
    expect(readyShortcutUrl(" https://www.icloud.com/shortcuts/cc143c7eec4a46cf999d08c5bbd16a2d ")).toBe("https://www.icloud.com/shortcuts/cc143c7eec4a46cf999d08c5bbd16a2d");
    for (const bad of [undefined, "", "https://evil.example/shortcuts/abc", "http://www.icloud.com/shortcuts/abc", "https://www.icloud.com/shortcuts/abc?x=1"]) {
      expect(readyShortcutUrl(bad)).toBeNull();
    }
  });
});

describe("connecting this iPhone", () => {
  it("runs the installed shortcut by name with the code as text input", () => {
    expect(SHORTCUT_NAME).toBe("FINNOS Apple Pay");
    expect(connectShortcutUrl("fns_ab+c/d")).toBe("shortcuts://run-shortcut?name=FINNOS%20Apple%20Pay&input=text&text=fns_ab%2Bc%2Fd");
  });
});

describe("what the Wallet automation needs", () => {
  it("points at the pending endpoint of this address", () => {
    expect(pendingEndpoint("https://finnos.vercel.app")).toBe("https://finnos.vercel.app/api/shortcuts/pendentes");
  });

  it("sends the three fields the server reads", () => {
    expect(AUTOMATION_FIELDS.map((f) => f.key)).toEqual(["valor", "descricao", "carteira"]);
  });

  it("builds the header from the fresh code, or a placeholder when there is none", () => {
    expect(bearerValue("fns_abc")).toBe("Bearer fns_abc");
    expect(bearerValue(null)).toBe("Bearer fns_…");
    expect(bearerValue("not-a-code")).toBe("Bearer fns_…");
  });

  it("takes the code out of the connection text", () => {
    expect(codeFromConnection("https://finnos.vercel.app|fns_abc")).toBe("fns_abc");
    expect(codeFromConnection(null)).toBeNull();
    expect(codeFromConnection("sem-barra")).toBeNull();
  });
});
