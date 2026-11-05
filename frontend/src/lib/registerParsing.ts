/** On-device understanding for Registro Inteligente: free text / voice transcripts
 *  ("Paguei 45 no Uber com o Nubank ontem") and OCR text from receipts. No network. */

export type RegisterKind = "Despesa" | "Receita" | "Transferência";

export interface ParsedRegister {
  value: number | null;
  kind: RegisterKind;
  date: string | null;
  accountId: string | null;
  destinationId: string | null;
  categoryId: string | null;
  name: string;
}

interface Named {
  id: string;
  name: string;
  institution?: string | null;
}

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** "1.234,56" → 1234.56 · "45" → 45 · "45.90" → 45.9 */
export function parseBRNumber(raw: string): number {
  const clean = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(clean)) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean.replace(",", "."));
}

const AMOUNT = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:reais|real|conto|pila))?/gi;

function findAmount(text: string): { value: number; raw: string } | null {
  const matches = [...text.matchAll(AMOUNT)].filter((m) => !/^\d{1,2}\/\d{1,2}/.test(text.slice(m.index ?? 0)));
  if (matches.length === 0) return null;
  // Prefer an explicit currency mention ("R$ 45" / "45 reais"), else the first number that is not a day.
  const preferred = matches.find((m) => /r\$/i.test(m[0]) || m[2]) ?? matches.find((m) => !/\bdia\s*$/i.test(text.slice(0, m.index ?? 0))) ?? matches[0];
  return { value: parseBRNumber(preferred[1]), raw: preferred[0] };
}

function isoOffset(base: string, days: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function findDate(text: string, today: string): string | null {
  const n = normalize(text);
  if (/\banteontem\b/.test(n)) return isoOffset(today, -2);
  if (/\bontem\b/.test(n)) return isoOffset(today, -1);
  if (/\bhoje\b/.test(n)) return today;
  const full = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (full) {
    const year = full[3] ? (full[3].length === 2 ? `20${full[3]}` : full[3]) : today.slice(0, 4);
    const iso = `${year}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
    return Number.isNaN(new Date(`${iso}T12:00:00`).getTime()) ? null : iso;
  }
  const day = n.match(/\bdia\s+(\d{1,2})\b/);
  if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) return `${today.slice(0, 7)}-${day[1].padStart(2, "0")}`;
  return null;
}

/** Keyword → words expected in the user's category names. */
const CATEGORY_HINTS: Array<[RegExp, string[]]> = [
  [/\b(uber|99|taxi|onibus|metro|gasolina|combustivel|estacionamento|pedagio)\b/, ["transporte"]],
  [/\b(cafe|almoco|jantar|restaurante|lanche|ifood|padaria|pizza|hamburguer|pao|acai|sorvete|salgado|marmita)\b/, ["alimentacao", "comida", "refeic", "restaurante"]],
  [/\b(mercado|supermercado|feira|hortifruti)\b/, ["mercado", "supermercado"]],
  [/\b(aluguel|luz|energia|agua|internet|condominio|gas)\b/, ["moradia", "casa"]],
  [/\b(netflix|spotify|assinatura|prime|disney|youtube)\b/, ["assinatura", "lazer"]],
  [/\b(farmacia|remedio|medico|consulta|exame|dentista)\b/, ["saude"]],
  [/\b(cinema|show|bar|balada|ingresso)\b/, ["lazer", "entretenimento"]],
  [/\b(roupa|loja|shopping|presente|compra)\b/, ["compras"]],
  [/\b(curso|faculdade|escola|livro)\b/, ["educacao"]],
  [/\b(salario|pagamento|freela|renda)\b/, ["renda", "salario"]],
];

export function parseRegisterText(
  text: string,
  { accounts, categories, today }: { accounts: Named[]; categories: Named[]; today: string },
): ParsedRegister {
  const n = normalize(text);
  const kind: RegisterKind = /\b(transferi|transferencia|enviei para|mandei para|passei para)\b/.test(n)
    ? "Transferência"
    : /\b(recebi|ganhei|salario|entrou|reembolso|rendimento)\b/.test(n)
      ? "Receita"
      : "Despesa";
  const amount = findAmount(text);
  const accountHits = accounts
    .map((a) => ({ a, at: Math.max(n.indexOf(normalize(a.name)), a.institution ? n.indexOf(normalize(a.institution)) : -1) }))
    .filter((hit) => hit.at >= 0)
    .sort((x, y) => x.at - y.at);
  let accountId: string | null = accountHits[0]?.a.id ?? null;
  let destinationId: string | null = null;
  if (kind === "Transferência") {
    // "Transferi 200 do Nubank para o Inter": the account after "para" is the destination.
    const paraAt = n.search(/\bpara\b/);
    const after = accountHits.find((hit) => paraAt >= 0 && hit.at > paraAt);
    const before = accountHits.find((hit) => paraAt < 0 || hit.at < paraAt);
    destinationId = after?.a.id ?? null;
    accountId = before?.a.id ?? null;
  }
  let categoryId: string | null = null;
  if (kind !== "Transferência") {
    const direct = categories.find((c) => normalize(c.name).length > 2 && n.includes(normalize(c.name)));
    categoryId = direct?.id ?? null;
    if (!categoryId) {
      for (const [pattern, names] of CATEGORY_HINTS) {
        if (!pattern.test(n)) continue;
        const found = categories.find((c) => names.some((word) => normalize(c.name).includes(word)));
        if (found) { categoryId = found.id; break; }
      }
    }
  }
  // The note keeps what was bought, not the amount, the date words or the account names.
  const accountWords = accounts.flatMap((a) => [a.name, a.institution ?? ""]).filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const name = text
    .replace(amount?.raw ?? "", " ")
    // Letter-aware edges: "\\b" fails next to an accented letter ("Itaú").
    .replace(accountWords.length ? new RegExp(`(?<![\\p{L}\\d])(${accountWords.join("|")})(?![\\p{L}\\d])`, "giu") : /$^/, " ")
    .replace(/\b(gastei|paguei|comprei|recebi|ganhei|transferi|hoje|ontem|anteontem|reais|real|no pix|pelo pix|com o|com a|no|na|de|do|da|em|pelo|pela|para o|para a|para)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    value: amount && amount.value > 0 ? amount.value : null,
    kind,
    date: findDate(text, today),
    accountId,
    destinationId,
    categoryId,
    name: name ? name.charAt(0).toUpperCase() + name.slice(1) : "",
  };
}

/** Reads the total, date and merchant from OCR text of a receipt or bill. */
export function parseReceiptText(text: string): { value: number | null; date: string | null; name: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const money = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/g;
  let value: number | null = null;
  for (const label of [/valor\s+(total|a\s+pagar|cobrado)/i, /total\s+a\s+pagar/i, /\btotal\b/i, /valor/i]) {
    const line = [...lines].reverse().find((l) => label.test(l) && money.test(l));
    money.lastIndex = 0;
    if (line) {
      const found = [...line.matchAll(money)].at(-1);
      if (found) { value = parseBRNumber(found[1]); break; }
    }
  }
  if (value === null) {
    const all = lines.flatMap((l) => [...l.matchAll(money)].map((m) => parseBRNumber(m[1])));
    value = all.length ? Math.max(...all) : null;
  }
  const dateMatch = text.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{2,4})\b/);
  const date = dateMatch ? `${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  const merchant = lines.find((l) => /[a-zA-ZÀ-ú]{3,}/.test(l) && !/cnpj|cpf|cupom|nota|fiscal|data|hora|total/i.test(l)) ?? "";
  return { value, date, name: merchant.slice(0, 40) };
}
