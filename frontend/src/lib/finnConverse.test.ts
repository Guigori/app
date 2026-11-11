import { describe, expect, it } from "vitest";
import { resolveTopic } from "./finnConverse";
import type { FinnMessage } from "./aiConversations";

const said = (topic: string): FinnMessage[] => [{ id: "1", role: "assistant", content: "…", createdAt: "", topic }];

describe("FINNOS IA keeps the subject of an analysis", () => {
  it("finds the analysis named in the question", () => {
    expect(resolveTopic("Me explique a análise Estimativa de saldo", null, [])?.def.id).toBe("previsao-saldo");
    expect(resolveTopic("Me explique a análise \"Meu orçamento\" com os meus números.", null, [])?.def.id).toBe("meu-orcamento");
  });
  it("uses the page the person came from, also for a summary full of numbers", () => {
    const t = resolveTopic("Me explique melhor: Seus limites somam R$ 6.750,00.", { analise: "Meu orçamento" }, []);
    expect(t?.def.id).toBe("meu-orcamento");
    expect(t?.followUp).toBe(false);
    expect(resolveTopic("Onde ajusto para fechar o ciclo?", { analise: "Meu orçamento" }, [])?.followUp).toBe(true);
  });
  it("answers a follow-up about the same analysis and lets other questions go to the analyst", () => {
    expect(resolveTopic("Como melhoro isso?", null, said("previsao-saldo"))?.def.id).toBe("previsao-saldo");
    expect(resolveTopic("quanto gastei com uber?", null, said("previsao-saldo"))).toBeNull();
    expect(resolveTopic("e se eu gastar R$ 100 hoje?", null, said("previsao-saldo"))).toBeNull();
  });
});
