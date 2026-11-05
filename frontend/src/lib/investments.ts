/** Investment positions typed in by the user. Account mode: /api/investments; local mode: this device. */
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";

export type InvestmentKind = "renda_fixa" | "tesouro" | "acoes" | "fundos" | "fii" | "cripto" | "previdencia" | "outro";

export const INVESTMENT_KINDS: Array<{ value: InvestmentKind; label: string }> = [
  { value: "renda_fixa", label: "Renda fixa (CDB, LCI…)" },
  { value: "tesouro", label: "Tesouro Direto" },
  { value: "acoes", label: "Ações" },
  { value: "fundos", label: "Fundos" },
  { value: "fii", label: "Fundos imobiliários" },
  { value: "cripto", label: "Cripto" },
  { value: "previdencia", label: "Previdência" },
  { value: "outro", label: "Outro" },
];

export interface Investment {
  id: string;
  name: string;
  kind: InvestmentKind;
  invested: number;
  current: number;
  updated_on: string;
  account: string | null;
  notes: string | null;
  created_at: string;
}

export type InvestmentInput = Omit<Investment, "id" | "created_at">;

const key = (userId: string) => `finnos:investments:v1:${userId}`;
function readLocal(userId: string): Investment[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) || "[]");
    return Array.isArray(parsed) ? (parsed as Investment[]) : [];
  } catch {
    return [];
  }
}
const writeLocal = (userId: string, rows: Investment[]) => localStorage.setItem(key(userId), JSON.stringify(rows));

export async function listInvestments(userId: string): Promise<Investment[]> {
  return isLocalMode() ? readLocal(userId) : apiGet<Investment[]>("/investments");
}

export async function saveInvestment(userId: string, input: InvestmentInput, id?: string): Promise<void> {
  if (!isLocalMode()) {
    if (id) await apiPut(`/investments/${encodeURIComponent(id)}`, input);
    else await apiPost("/investments", input);
    return;
  }
  const rows = readLocal(userId);
  writeLocal(userId, id
    ? rows.map((r) => (r.id === id ? { ...r, ...input } : r))
    : [...rows, { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() }]);
}

export async function removeInvestment(userId: string, id: string): Promise<void> {
  if (!isLocalMode()) { await apiDelete(`/investments/${encodeURIComponent(id)}`); return; }
  writeLocal(userId, readLocal(userId).filter((r) => r.id !== id));
}

export function investmentTotals(rows: Investment[]) {
  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const current = rows.reduce((s, r) => s + r.current, 0);
  const gain = Math.round((current - invested) * 100) / 100;
  return { invested, current, gain, gainPct: invested > 0 ? Math.round((gain / invested) * 1000) / 10 : null };
}
