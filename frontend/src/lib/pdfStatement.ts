/** PDF bank statements and invoices → the CSV the importer already understands.
 *  The text is read on the device with pdf.js (loaded only when a PDF is chosen). */

const MONEY = /(?:R\$\s*)?-?\s?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s?[DC-](?![a-zA-Z]))?/g;
const DATE_AT_START = /^(\d{2})[/.](\d{2})(?:[/.](\d{2,4}))?\s+/;

function toNumber(token: string): number {
  // "-12,50", "R$ -12,50", "12,50-" and "12,50 D" (débito) are outflows.
  const text = token.trim();
  const negative = /^(R\$\s*)?-/.test(text) || /[-D]\s*$/.test(text);
  const digits = token.replace(/[^\d,]/g, "").replace(",", ".");
  const value = Number(digits);
  return negative ? -value : value;
}

/**
 * One movement per line: a date at the start, a description and the amount.
 * When a line ends with two amounts (value and running balance), the first is the value.
 * Lines without a date (headers, totals, balance carried forward) are ignored.
 */
export function statementLinesToCsv(lines: string[], fallbackYear: number): string {
  const rows: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    const date = line.match(DATE_AT_START);
    if (!date) continue;
    if (/saldo (anterior|do dia|final)|^.{0,12}total/i.test(line)) continue;
    const rest = line.slice(date[0].length);
    const amounts = [...rest.matchAll(MONEY)];
    if (!amounts.length) continue;
    const valueToken = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
    const description = rest.slice(0, amounts[0].index).replace(/[;"]/g, ",").trim() || "Lançamento";
    const year = date[3] ? (date[3].length === 2 ? `20${date[3]}` : date[3]) : String(fallbackYear);
    const value = toNumber(valueToken[0]);
    rows.push(`${year}-${date[2]}-${date[1]};${description};${value.toFixed(2).replace(".", ",")}`);
  }
  return ["Data;Descrição;Valor", ...rows].join("\n");
}

/** Reads every page, rebuilds the visual lines (same height = same line) and converts them. */
export async function pdfToStatementCsv(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  let text = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const byY = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      byY.set(y, [...(byY.get(y) ?? []), { x: item.transform[4], s: item.str }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      const line = byY.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ");
      lines.push(line);
      text += line + "\n";
    }
  }
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? new Date().getFullYear());
  return statementLinesToCsv(lines, year);
}
