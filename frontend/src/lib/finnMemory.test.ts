import { describe, expect, it } from "vitest";
import { emptyMemory, memoryCommand, notesFor, personalSuggestions, rememberFeedback, rememberTopic } from "./finnMemory";
import { parseQuestion } from "./finnQuestion";

const categories = [{ id: "rest", name: "Restaurantes" }, { id: "trans", name: "Transporte" }];
const ctx = { today: "2026-11-05", categories, accounts: [], cards: [], names: ["uber"] };

describe("FINNOS IA learns from the user", () => {
  it("learns that a word counts as a category, and uses it in the next question", () => {
    const taught = memoryCommand("Lembre que lanche é Restaurantes", emptyMemory(), categories)!;
    expect(taught.memory.aliases).toEqual({ lanche: "rest" });
    expect(taught.text).toContain("categoria Restaurantes");
    expect(memoryCommand("ifood conta como restaurantes", taught.memory, categories)!.memory.aliases).toEqual({ lanche: "rest", ifood: "rest" });
    const q = parseQuestion("quanto gastei com lanche?", { ...ctx, aliases: taught.memory.aliases });
    expect(q.entities[0]).toMatchObject({ kind: "category", id: "rest" });
  });

  it("keeps a note about something that is not a category and repeats it back", () => {
    const taught = memoryCommand("lembre que Uber é trabalho", emptyMemory(), categories)!;
    expect(taught.memory.notes).toEqual({ uber: "Uber é trabalho" });
    expect(notesFor(taught.memory, parseQuestion("quanto gastei de uber", ctx))).toEqual(["Uber é trabalho"]);
  });

  it("forgets on request and says what it knows", () => {
    let memory = memoryCommand("lembre que Uber é trabalho", emptyMemory(), categories)!.memory;
    memory = memoryCommand("lembre que lanche é restaurantes", memory, categories)!.memory;
    expect(memoryCommand("o que você sabe sobre mim?", memory, categories)!.text).toContain("lanche conta como Restaurantes");
    memory = memoryCommand("esqueça uber", memory, categories)!.memory;
    expect(memory.notes).toEqual({});
    expect(memory.aliases).toEqual({ lanche: "rest" });
  });

  it("follows the answer style the user asks for", () => {
    expect(memoryCommand("responda mais curto", emptyMemory(), categories)!.memory.style).toBe("curto");
    expect(memoryCommand("quero respostas mais detalhadas", emptyMemory(), categories)!.memory.style).toBe("detalhado");
  });

  it("does not take an ordinary question for a lesson", () => {
    expect(memoryCommand("qual é meu saldo?", emptyMemory(), categories)).toBeNull();
    expect(memoryCommand("quanto gastei de uber este mês", emptyMemory(), categories)).toBeNull();
  });

  it("suggests the questions the user asks most, and counts feedback", () => {
    const q = parseQuestion("quanto gastei de uber este mês", ctx);
    let memory = rememberTopic(emptyMemory(), q, "Quanto gastei de Uber este mês?");
    expect(personalSuggestions(memory)).toEqual([]);
    memory = rememberTopic(memory, q, "Quanto gastei de Uber este mês?");
    expect(personalSuggestions(memory)).toEqual(["Quanto gastei de Uber este mês?"]);
    expect(rememberFeedback(memory, "total", "down").feedback).toEqual({ total: { up: 0, down: 1 } });
  });
});
