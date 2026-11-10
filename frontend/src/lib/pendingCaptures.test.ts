import { describe, expect, it } from "vitest";
import { asksDebitOrCredit, canRegister, captureBadge, choiceSummary, matchesCaptureFilter, confirmBody, initialChoice, orderForReview, invoiceFor, invoiceLabel, needsWallet, readyToRegister, refusalMessage, waitingLabel } from "@/lib/pendingCaptures";
import type { PendingCapture } from "@/types/finnos";

const capture = (over: Partial<PendingCapture> = {}): PendingCapture => ({
  id: "p1", name: "Mercado Do Ernesto", value: 4.99, date: "2026-11-09",
  is_test: false, waiting_days: 0, stale: false,
  source_kind: "desconhecido", source_registered: false, source_id: null, source_name: null,
  source_sent: "Refeição Pass", pays_from: null, origin: "“Refeição Pass” não está cadastrado no FINNOS",
  suggested_method: "debito", suggested_account_id: null, suggested_card_id: null, suggested_category_id: null,
  learned_wallet: false, learned_category: false, ...over,
});

describe("pending Apple Pay purchases", () => {
  it("starts in débito with what FINNOS learned already filled in", () => {
    const item = capture({ suggested_account_id: "acc-nu", suggested_card_id: "card-nu", suggested_category_id: "cat-mkt" });
    expect(initialChoice(item)).toEqual({ method: "debito", accountId: "acc-nu", cardId: "card-nu", categoryId: "cat-mkt", installments: 1 });
  });

  it("débito needs the account, crédito needs the card", () => {
    const base = initialChoice(capture());
    expect(canRegister(base)).toBe(false);
    expect(() => confirmBody(base)).toThrow("conta");
    expect(() => confirmBody({ ...base, method: "credito" })).toThrow("cartão");
    expect(canRegister({ ...base, accountId: "acc-it" })).toBe(true);
    expect(canRegister({ ...base, method: "credito", cardId: "card-nu" })).toBe(true);
  });

  it("sends the method with only its own wallet, installments only in crédito", () => {
    const choice = { method: "debito" as const, accountId: "acc-it", cardId: "card-nu", categoryId: "cat-food", installments: 3 };
    expect(confirmBody(choice)).toEqual({ method: "debito", account_id: "acc-it", category_id: "cat-food" });
    expect(confirmBody({ ...choice, method: "credito" })).toEqual({ method: "credito", card_id: "card-nu", installments: 3, category_id: "cat-food" });
    expect(confirmBody({ ...choice, method: "credito", installments: 1, categoryId: "" })).toEqual({ method: "credito", card_id: "card-nu" });
  });

  it("registers in batch only what has an account to come out of", () => {
    const items = [capture({ suggested_account_id: "a" }), capture(), capture({ suggested_card_id: "c" }), capture({ is_test: true, suggested_account_id: "a" })];
    expect(readyToRegister(items)).toBe(1);
    expect(needsWallet(items)).toBe(1);
  });

  it("puts a crédito purchase on the invoice the server will use", () => {
    const card = { closing_day: 5, due_day: 12 };
    expect(invoiceFor("2026-11-05", card)).toEqual({ closing: "2026-11-05", due: "2026-11-12", afterClosing: false });
    expect(invoiceFor("2026-11-06", card)).toEqual({ closing: "2026-12-05", due: "2026-12-12", afterClosing: true });
    // Due before closing day: paid the month after it closes.
    expect(invoiceFor("2026-11-20", { closing_day: 28, due_day: 5 })).toEqual({ closing: "2026-11-28", due: "2026-12-05", afterClosing: false });
    // Closing on the 31st in a short month, and the year turning.
    expect(invoiceFor("2027-02-10", { closing_day: 31, due_day: 8 }).closing).toBe("2027-02-28");
    expect(invoiceFor("2026-12-30", { closing_day: 25, due_day: 2 })).toEqual({ closing: "2027-01-25", due: "2027-02-02", afterClosing: true });
    expect(invoiceLabel(invoiceFor("2026-11-06", card))).toBe("Fatura de dezembro · fecha 05/12 · vence 12/12");
  });

  it("flags a purchase waiting for days", () => {
    expect(waitingLabel(capture({ stale: true, waiting_days: 4 }))).toBe("pendente há 4 dias");
    expect(waitingLabel(capture())).toBe("");
  });

  it("shows the server's own reason when it refuses", () => {
    expect(refusalMessage({ body: { detail: "Débito: escolha a conta de onde saiu o dinheiro." } }, "erro")).toBe("Débito: escolha a conta de onde saiu o dinheiro.");
    expect(refusalMessage(new Error("x"), "erro")).toBe("erro");
  });

  it("sums up in one line what Registrar will do, or what is missing", () => {
    const accounts = [{ id: "a1", name: "Itaú" }];
    const cards = [{ id: "c1", name: "Nubank Roxinho" }];
    const cats = [{ id: "k1", name: "Mercado" }];
    const base = { method: "debito" as const, accountId: "a1", cardId: "c1", categoryId: "k1", installments: 3 };
    expect(choiceSummary(base, accounts, cards, cats)).toEqual({ text: "Débito · Itaú · Mercado", missing: false });
    expect(choiceSummary({ ...base, method: "credito" }, accounts, cards, cats).text).toBe("Crédito · Nubank Roxinho · 3x · Mercado");
    expect(choiceSummary({ ...base, categoryId: "" }, accounts, cards, cats).text).toBe("Débito · Itaú · sem categoria");
    expect(choiceSummary({ ...base, accountId: "" }, accounts, cards, cats)).toEqual({ text: "Débito · falta escolher a conta", missing: true });
  });

  it("puts forgotten purchases first, then the newest", () => {
    const items = [
      capture({ id: "new-old", date: "2026-11-01" }),
      capture({ id: "stale-2", stale: true, waiting_days: 3 }),
      capture({ id: "new", date: "2026-11-09" }),
      capture({ id: "stale-5", stale: true, waiting_days: 5 }),
    ];
    expect(orderForReview(items).map((i) => i.id)).toEqual(["stale-5", "stale-2", "new", "new-old"]);
  });

  it("asks débito or crédito when Apple Pay's name is both an account and a card, and keeps it out of the batch", () => {
    const both = capture({ ambiguous: true, suggested_account_id: "acc-nu", suggested_card_id: "card-nu" });
    expect(asksDebitOrCredit(both)).toBe(true);
    expect(asksDebitOrCredit(capture({ suggested_account_id: "acc-nu", suggested_card_id: "card-nu" }))).toBe(false);
    expect(readyToRegister([both, capture({ suggested_account_id: "a" })])).toBe(1);
  });

  it("marks and filters what came from Apple Pay", () => {
    expect(captureBadge({ capture: "apple_pay" })).toBe("Apple Pay");
    expect(captureBadge({ capture: "apple_pay_auto" })).toBe("Apple Pay · automático");
    expect(captureBadge({ capture: "apple_pay_auto", capture_unusual: true })).toBe("Apple Pay · automático · valor alto");
    expect(captureBadge({ capture: null })).toBeNull();
    const rows = [{ capture: "apple_pay" }, { capture: "apple_pay_auto" }, { capture: null }];
    expect(rows.filter((r) => matchesCaptureFilter(r, "apple_pay")).length).toBe(2);
    expect(rows.filter((r) => matchesCaptureFilter(r, "apple_pay_auto")).length).toBe(1);
    expect(rows.filter((r) => matchesCaptureFilter(r, "todas")).length).toBe(3);
  });
});
