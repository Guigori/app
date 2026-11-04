/** Export and restore of the user's data (Configurações → Dados). */
import { apiGet, apiPost } from "@/lib/api";
import { fetchAccounts, fetchCards, fetchCategories, fetchTransactions } from "@/lib/data";
import { isLocalMode } from "@/lib/mode";
import { readDb, writeDb, type LocalDb } from "@/lib/local/store";

const stamp = () => new Date().toISOString().slice(0, 10);

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Full backup: the server's checksummed export, or the whole local database. */
export async function downloadBackup(): Promise<void> {
  const data = isLocalMode()
    ? { format: "finnos-backup", version: 1, source: "local", exported_at: new Date().toISOString(), local_db: readDb() }
    : await apiGet<Record<string, unknown>>("/finance/backup");
  download(`finnos-backup-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json");
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Every movement as a spreadsheet (; separated, Brazilian decimal comma). */
export async function downloadTransactionsCsv(): Promise<number> {
  const [transactions, accounts, cards, categories] = await Promise.all([
    fetchTransactions({ start_date: "1900-01-01", end_date: "2999-12-31" }),
    fetchAccounts(),
    fetchCards(),
    fetchCategories(),
  ]);
  const name = (list: Array<{ id: string; name: string }>, id: string | null | undefined) => list.find((x) => x.id === id)?.name ?? "";
  const header = ["Data", "Descrição", "Tipo", "Valor", "Status", "Categoria", "Conta", "Cartão", "Parcela", "Notas"];
  const lines = [...transactions].sort((a, b) => a.date.localeCompare(b.date)).map((tx) => [
    tx.date,
    tx.name,
    tx.type,
    tx.value.toFixed(2).replace(".", ","),
    tx.status,
    name(categories, tx.category_id),
    name(accounts, tx.account_id),
    name(cards, tx.card_id),
    tx.installment ? `${tx.current_installment ?? 1}/${tx.total_installments ?? 1}` : "",
    tx.notes ?? "",
  ].map(csvCell).join(";"));
  download(`finnos-lancamentos-${stamp()}.csv`, "﻿" + [header.join(";"), ...lines].join("\n"), "text/csv;charset=utf-8");
  return transactions.length;
}

export type RestoreResult = { restored: Record<string, number> };

/** Restores a backup file. Local backups replace this device's data; account backups go to an empty account. */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await file.text()) as Record<string, unknown>;
  } catch {
    throw new Error("O arquivo não é um JSON válido.");
  }
  if (data.format !== "finnos-backup") throw new Error("Este arquivo não é um backup do FINNOS.");
  if (isLocalMode()) {
    if (data.source !== "local" || !data.local_db) throw new Error("Este backup é de uma conta completa. Entre com a sua conta para restaurá-lo.");
    const db = data.local_db as LocalDb;
    if (!Array.isArray(db.accounts) || !Array.isArray(db.transactions) || !Array.isArray(db.categories)) throw new Error("Backup incompleto.");
    writeDb({ ...db, revision: Math.max(readDb().revision ?? 0, db.revision ?? 0) + 1 });
    return { restored: { transactions: Array.isArray(db.transactions) ? db.transactions.length : 0 } };
  }
  if (data.source === "local") throw new Error("Backup do modo local: use “Criar conta completa” no modo local para levar esses dados.");
  return apiPost<RestoreResult>("/finance/restore", data);
}
