import { describe, expect, it } from "vitest";
import { offerFeatured } from "@/lib/insights/layout";

describe("offerFeatured", () => {
  it("puts Descobertas at the top, the new tiles after the small ones, and never duplicates", () => {
    const next = offerFeatured({
      inicio: [{ key: "1", id: "gastar-hoje", size: "S" }, { key: "2", id: "fatura-que-vem", size: "S" }, { key: "3", id: "previsao-saldo", size: "L" }],
      analise: [{ key: "4", id: "assinaturas", size: "M" }],
    });
    expect(next.inicio.map((w) => w.id)).toEqual(["descobertas", "gastar-hoje", "fatura-que-vem", "ate-salario", "em-aberto", "resultado-mes", "previsao-saldo"]);
    expect(next.analise.filter((w) => w.id === "assinaturas")).toHaveLength(1);
    expect(next.analise[0].id).toBe("assinaturas");
  });
});

describe("offerAnalysisTop", () => {
  it("brings what used to be fixed on Análise to the top of the board, without repeating", async () => {
    const { offerAnalysisTop } = await import("@/lib/insights/layout");
    const next = offerAnalysisTop({ inicio: [], analise: [{ key: "x", id: "seis-meses", size: "M" }, { key: "y", id: "faturas", size: "L" }] });
    expect(next.analise.map((w) => w.id)).toEqual(["descobertas", "resultado-mes", "orcamento", "contas", "habitos", "categorias", "compromissos", "seis-meses", "faturas"]);
  });
});
