// pt-BR formatters and label maps. Money is always BRL; months are "YYYY-MM" strings.
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AccountType, CategoryGroup, TxStatus, TxType } from "@/types/finnos";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number): string {
  return brl.format(value);
}

export function formatHiddenBRL(): string {
  return "R$ ••••••";
}

export function formatSignedBRL(value: number): string {
  return `${value < 0 ? "-" : "+"}${brl.format(Math.abs(value))}`;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addMonth(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const idx = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = format(new Date(y, m - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "dd/MM/yyyy");
}

/** Parses "1.450,90" / "1450.90" / "1450,9" into a number; null when invalid. */
export function parseAmount(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, "").replace(/R\$/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export const TX_TYPE_LABEL: Record<TxType, string> = {
  receita: "Receita",
  despesa: "Despesa",
  transferencia: "Transferência",
};

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  pago: "Pago",
  pendente: "Pendente",
  agendado: "Agendado",
};

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  necessidades: "Necessidades",
  desejos: "Desejos",
  metas: "Metas e investimentos",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  corrente: "Conta corrente",
  salario: "Conta salário",
  digital: "Conta digital",
  poupanca: "Poupança",
  carteira: "Carteira",
};
