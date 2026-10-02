// Local-mode data engine: the same business rules as backend/lib/stats.py, run in
// the browser. Keep the two in sync — a rule change belongs in both places.

import { addMonth, currentMonth, todayISO } from "@/lib/format";
import { newId, readDb, writeDb, freshDb, wipeDb, type LocalDb } from "@/lib/local/store";
import type {
  Account,
  AccountDetail,
  AccountInput,
  Category,
  CategoryGroup,
  CategoryInput,
  CategorySlice,
  Dashboard,
  RuleItem,
  RuleStatus,
  Transaction,
  TransactionInput,
} from "@/types/finnos";

const round2 = (v: number) => Math.round(v * 100) / 100;

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))];
  const [yb, mb] = [Number(b.slice(0, 4)), Number(b.slice(5, 7))];
  return yb * 12 + mb - (ya * 12 + ma);
}

function monthBounds(month: string): [string, string] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

/** Positive amount the transaction contributes to `month`'s income/expense stats. */
function monthPortion(tx: Transaction, month: string): number | null {
  if (tx.type === "transferencia" || tx.status !== "pago") return null;
  if (tx.installment) {
    const n = tx.total_installments ?? 1;
    const offset = monthsBetween(tx.date.slice(0, 7), month);
    return offset >= 0 && offset < n ? round2(tx.installment_value ?? 0) : null;
  }
  return tx.date.slice(0, 7) === month ? round2(tx.value) : null;
}

/** Signed effect on each account balance — "pago" moves money, pending/scheduled never does. */
function balanceEffects(tx: Transaction, today: string): [string, number][] {
  if (tx.status !== "pago") return [];
  let v = tx.value;
  if (tx.installment) {
    const n = tx.total_installments ?? 1;
    const due = monthsBetween(tx.date.slice(0, 7), today.slice(0, 7)) + 1;
    v = round2((tx.installment_value ?? 0) * Math.max(0, Math.min(due, n)));
  }
  if (tx.type === "receita") return [[tx.account_id, round2(v)]];
  if (tx.type === "despesa") return [[tx.account_id, round2(-v)]];
  const effects: [string, number][] = [[tx.account_id, round2(-v)]];
  if (tx.to_account_id && tx.to_account_id !== tx.account_id) effects.push([tx.to_account_id, round2(v)]);
  return effects;
}

function enrich(db: LocalDb, tx: Transaction): Transaction {
  const account = db.accounts.find((a) => a.id === tx.account_id);
  const to = tx.to_account_id ? db.accounts.find((a) => a.id === tx.to_account_id) : undefined;
  const category = tx.category_id ? db.categories.find((c) => c.id === tx.category_id) : undefined;
  return {
    ...tx,
    account_name: account?.name ?? "",
    to_account_name: to?.name ?? null,
    category_name: category?.name ?? null,
    category_color: category?.color ?? null,
    category_icon: category?.icon ?? null,
  };
}

function enrichedAccounts(db: LocalDb): Account[] {
  const today = todayISO();
  const balance = new Map(db.accounts.map((a) => [a.id, a.initial_balance]));
  const income = new Map(db.accounts.map((a) => [a.id, 0]));
  const expense = new Map(db.accounts.map((a) => [a.id, 0]));
  for (const tx of db.transactions) {
    for (const [accId, amount] of balanceEffects(tx, today)) {
      balance.set(accId, (balance.get(accId) ?? 0) + amount);
      if (tx.type === "receita") income.set(accId, (income.get(accId) ?? 0) + amount);
      else if (tx.type === "despesa") expense.set(accId, (expense.get(accId) ?? 0) - amount);
    }
  }
  return db.accounts.map((a) => ({
    ...a,
    balance: round2(balance.get(a.id) ?? 0),
    total_income: round2(Math.max(income.get(a.id) ?? 0, 0)),
    total_expense: round2(Math.max(expense.get(a.id) ?? 0, 0)),
  }));
}

function sortedTransactions(db: LocalDb): Transaction[] {
  return [...db.transactions].sort((a, b) =>
    a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date),
  );
}

// --- Accounts ---------------------------------------------------------------

export function localListAccounts(): Account[] {
  return enrichedAccounts(readDb());
}

export function localGetAccount(id: string): AccountDetail {
  const db = readDb();
  const account = enrichedAccounts(db).find((a) => a.id === id);
  if (!account) throw new Error("Conta não encontrada.");
  const transactions = sortedTransactions(db)
    .filter((t) => t.account_id === id || t.to_account_id === id)
    .slice(0, 8)
    .map((t) => enrich(db, t));
  return { account, transactions };
}

export function localCreateAccount(input: AccountInput): Account {
  const db = readDb();
  const account: Account = {
    ...input,
    id: newId(),
    balance: input.initial_balance,
    total_income: 0,
    total_expense: 0,
    created_at: new Date().toISOString(),
  };
  db.accounts.push(account);
  writeDb(db);
  return account;
}

export function localUpdateAccount(id: string, input: AccountInput): Account {
  const db = readDb();
  const index = db.accounts.findIndex((a) => a.id === id);
  if (index < 0) throw new Error("Conta não encontrada.");
  db.accounts[index] = { ...db.accounts[index], ...input };
  writeDb(db);
  return enrichedAccounts(db).find((a) => a.id === id)!;
}

export function localDeleteAccount(id: string): void {
  const db = readDb();
  const used = db.transactions.some((t) => t.account_id === id || t.to_account_id === id);
  if (used) {
    throw new Error(
      "Esta conta tem transações vinculadas. Exclua ou mova as transações antes de excluir a conta.",
    );
  }
  db.accounts = db.accounts.filter((a) => a.id !== id);
  writeDb(db);
}

// --- Categories -------------------------------------------------------------

export function localListCategories(): Category[] {
  return readDb().categories;
}

export function localCreateCategory(input: CategoryInput): Category {
  const db = readDb();
  const category: Category = { ...input, id: newId(), created_at: new Date().toISOString() };
  db.categories.push(category);
  writeDb(db);
  return category;
}

export function localUpdateCategory(id: string, input: CategoryInput): Category {
  const db = readDb();
  const index = db.categories.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Categoria não encontrada.");
  db.categories[index] = { ...db.categories[index], ...input };
  writeDb(db);
  return db.categories[index];
}

export function localDeleteCategory(id: string): void {
  const db = readDb();
  if (db.transactions.some((t) => t.category_id === id)) {
    throw new Error(
      "Esta categoria tem transações vinculadas. Mova-as para outra categoria antes de excluir.",
    );
  }
  db.categories = db.categories.filter((c) => c.id !== id);
  writeDb(db);
}

// --- Transactions -----------------------------------------------------------

export interface LocalTxFilters {
  month?: string;
  type?: string;
  status?: string;
  category_id?: string;
  account_id?: string;
  search?: string;
}

export function localListTransactions(filters: LocalTxFilters): Transaction[] {
  const db = readDb();
  let rows = sortedTransactions(db);
  if (filters.month) {
    const [start, end] = monthBounds(filters.month);
    rows = rows.filter((t) => t.date >= start && t.date <= end);
  }
  if (filters.type) rows = rows.filter((t) => t.type === filters.type);
  if (filters.status) rows = rows.filter((t) => t.status === filters.status);
  if (filters.category_id) rows = rows.filter((t) => t.category_id === filters.category_id);
  if (filters.account_id) {
    rows = rows.filter((t) => t.account_id === filters.account_id || t.to_account_id === filters.account_id);
  }
  if (filters.search?.trim()) {
    const needle = filters.search.trim().toLowerCase();
    rows = rows.filter((t) => t.name.toLowerCase().includes(needle));
  }
  return rows.map((t) => enrich(db, t));
}

function buildTransaction(db: LocalDb, input: TransactionInput, existing?: Transaction): Transaction {
  if (!db.accounts.some((a) => a.id === input.account_id)) {
    throw new Error("Conta inválida: selecione uma conta cadastrada.");
  }
  if (input.type === "transferencia") {
    if (!input.to_account_id || input.to_account_id === input.account_id) {
      throw new Error("Escolha contas diferentes para a transferência.");
    }
  }
  if (input.installment) {
    if (input.type !== "despesa") throw new Error("Somente despesas podem ser parceladas.");
    if (!input.total_installments || input.total_installments < 2) {
      throw new Error("Informe o número total de parcelas (mínimo 2).");
    }
  }
  const total = round2(input.adjusted_value ?? input.value);
  return {
    id: existing?.id ?? newId(),
    name: input.name.trim(),
    value: total,
    type: input.type,
    status: input.status,
    date: input.date,
    account_id: input.account_id,
    account_name: "",
    to_account_id: input.type === "transferencia" ? input.to_account_id : null,
    to_account_name: null,
    category_id: input.category_id,
    category_name: null,
    category_color: null,
    category_icon: null,
    fixed: input.fixed,
    recurrence: input.fixed ? input.recurrence ?? "mensal" : null,
    installment: input.installment,
    total_installments: input.installment ? input.total_installments : null,
    current_installment: input.installment ? input.current_installment ?? 1 : null,
    installment_value: input.installment && input.total_installments ? round2(total / input.total_installments) : null,
    adjusted_value: input.adjusted_value,
    attachment: input.attachment,
    notes: input.notes,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
}

export function localCreateTransaction(input: TransactionInput): Transaction {
  const db = readDb();
  const tx = buildTransaction(db, input);
  db.transactions.push(tx);
  writeDb(db);
  return enrich(db, tx);
}

export function localUpdateTransaction(id: string, input: TransactionInput): Transaction {
  const db = readDb();
  const index = db.transactions.findIndex((t) => t.id === id);
  if (index < 0) throw new Error("Transação não encontrada.");
  const tx = buildTransaction(db, input, db.transactions[index]);
  db.transactions[index] = tx;
  writeDb(db);
  return enrich(db, tx);
}

export function localDeleteTransaction(id: string): void {
  const db = readDb();
  db.transactions = db.transactions.filter((t) => t.id !== id);
  writeDb(db);
}

// --- Dashboard --------------------------------------------------------------

const GROUP_SHARES: Record<CategoryGroup, number> = { necessidades: 0.5, desejos: 0.3, metas: 0.2 };
const GROUP_LABELS: Record<CategoryGroup, string> = {
  necessidades: "Necessidades",
  desejos: "Desejos",
  metas: "Metas e investimentos",
};

export function localDashboard(month?: string | null): Dashboard {
  const db = readDb();
  const today = todayISO();
  const m = month ?? currentMonth();
  const prev = addMonth(m, -1);

  let totalBalance = db.accounts.reduce((sum, a) => sum + a.initial_balance, 0);
  for (const tx of db.transactions) {
    for (const [, amount] of balanceEffects(tx, today)) totalBalance += amount;
  }

  let income = 0;
  let expense = 0;
  let prevIncome = 0;
  let prevExpense = 0;
  let prevCount = 0;
  const byCategory = new Map<string | null, number>();
  const byGroup: Record<CategoryGroup, number> = { necessidades: 0, desejos: 0, metas: 0 };

  for (const tx of db.transactions) {
    const portion = monthPortion(tx, m);
    if (portion !== null) {
      if (tx.type === "receita") {
        income += portion;
      } else {
        expense += portion;
        const category = tx.category_id ? db.categories.find((c) => c.id === tx.category_id) : undefined;
        const key = category?.id ?? null;
        byCategory.set(key, (byCategory.get(key) ?? 0) + portion);
        if (category) byGroup[category.group] += portion;
      }
    }
    const prevPortion = monthPortion(tx, prev);
    if (prevPortion !== null) {
      prevCount += 1;
      if (tx.type === "receita") prevIncome += prevPortion;
      else prevExpense += prevPortion;
    }
  }

  income = round2(income);
  expense = round2(expense);

  const categories: CategorySlice[] = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([catId, total]) => {
      const category = catId ? db.categories.find((c) => c.id === catId) : undefined;
      return {
        category_id: catId,
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "#94A3B8",
        icon: category?.icon ?? "more-horizontal",
        total: round2(total),
        percent: expense ? Math.round((total / expense) * 1000) / 10 : 0,
      };
    });

  const rule: RuleItem[] = (["necessidades", "desejos", "metas"] as CategoryGroup[]).map((key) => {
    const spent = round2(byGroup[key]);
    const limit = round2(income * GROUP_SHARES[key]);
    const percent = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : spent === 0 ? 0 : 101;
    const status: RuleStatus = percent <= 80 ? "dentro" : percent <= 100 ? "proximo" : "acima";
    return { key, label: GROUP_LABELS[key], spent, limit, percent, status };
  });

  const [start, end] = monthBounds(m);
  const recent = sortedTransactions(db)
    .filter((t) => t.date >= start && t.date <= end)
    .slice(0, 6)
    .map((t) => enrich(db, t));

  return {
    month: m,
    total_balance: round2(totalBalance),
    income,
    expense,
    month_balance: round2(income - expense),
    prev_income: prevCount ? round2(prevIncome) : null,
    prev_expense: prevCount ? round2(prevExpense) : null,
    invested: 0,
    categories,
    rule,
    recent,
  };
}

// --- Demo / reset -----------------------------------------------------------

const DEMO_ACCOUNTS: AccountInput[] = [
  { name: "Nubank", institution: "Nubank", type: "digital", color: "#8A05BE", initial_balance: 4000, active: true },
  { name: "Inter", institution: "Banco Inter", type: "digital", color: "#FF7A00", initial_balance: 450, active: true },
  { name: "Itaú", institution: "Itaú Unibanco", type: "corrente", color: "#EC7000", initial_balance: 1800, active: true },
  { name: "Carteira", institution: "Dinheiro", type: "carteira", color: "#64748B", initial_balance: 300, active: true },
];

function day(month: string, d: number): string {
  const y = Number(month.slice(0, 4));
  const mm = Number(month.slice(5, 7));
  const last = new Date(y, mm, 0).getDate();
  return `${month}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function localLoadDemo(): void {
  const db = freshDb(readDb().profile.name);
  const m0 = currentMonth();
  const m1 = addMonth(m0, -1);

  db.accounts = DEMO_ACCOUNTS.map((a) => ({
    ...a,
    id: newId(),
    balance: a.initial_balance,
    total_income: 0,
    total_expense: 0,
    created_at: new Date().toISOString(),
  }));
  const acc = (name: string) => db.accounts.find((a) => a.name === name)!.id;
  const cat = (name: string) => db.categories.find((c) => c.name === name)?.id ?? null;

  const rows: Array<Partial<TransactionInput> & { name: string; value: number; date: string }> = [
    { name: "Salário", value: 5200, type: "receita", account_id: acc("Itaú"), category_id: cat("Renda"), date: day(m0, 5) },
    { name: "Aluguel", value: 1450, account_id: acc("Itaú"), category_id: cat("Moradia"), date: day(m0, 5), fixed: true },
    { name: "Internet fibra", value: 99.9, account_id: acc("Itaú"), category_id: cat("Moradia"), date: day(m0, 8), fixed: true },
    { name: "Mercado do mês", value: 212.4, account_id: acc("Nubank"), category_id: cat("Mercado"), date: day(m0, 3) },
    { name: "Feira da semana", value: 189.9, account_id: acc("Nubank"), category_id: cat("Mercado"), date: day(m0, 12) },
    { name: "Uber trabalho", value: 38.6, account_id: acc("Nubank"), category_id: cat("Transporte"), date: day(m0, 6) },
    { name: "Academia", value: 89.9, account_id: acc("Nubank"), category_id: cat("Saúde"), date: day(m0, 10), fixed: true },
    { name: "Netflix", value: 44.9, account_id: acc("Nubank"), category_id: cat("Assinaturas"), date: day(m0, 12), fixed: true },
    { name: "Spotify", value: 21.9, account_id: acc("Inter"), category_id: cat("Assinaturas"), date: day(m0, 15), fixed: true },
    { name: "Cinema", value: 55, account_id: acc("Nubank"), category_id: cat("Lazer"), date: day(m0, 20) },
    { name: "MacBook", value: 6000, account_id: acc("Nubank"), category_id: cat("Compras"), date: day(addMonth(m0, -2), 14), installment: true, total_installments: 10, current_installment: 3 },
    { name: "Transferência para o Nubank", value: 500, type: "transferencia", account_id: acc("Itaú"), to_account_id: acc("Nubank"), date: day(m0, 7) },
    { name: "Conta de luz", value: 186.7, account_id: acc("Itaú"), category_id: cat("Moradia"), date: day(m0, 25), status: "agendado" },
    { name: "Farmácia", value: 68.4, account_id: acc("Carteira"), category_id: cat("Saúde"), date: day(m0, 8), status: "pendente" },
    { name: "Salário", value: 5200, type: "receita", account_id: acc("Itaú"), category_id: cat("Renda"), date: day(m1, 5) },
    { name: "Freelance", value: 800, type: "receita", account_id: acc("Inter"), category_id: cat("Renda"), date: day(m1, 18) },
    { name: "Aluguel", value: 1450, account_id: acc("Itaú"), category_id: cat("Moradia"), date: day(m1, 5), fixed: true },
    { name: "Mercado do mês", value: 260.1, account_id: acc("Nubank"), category_id: cat("Mercado"), date: day(m1, 3) },
    { name: "Combustível", value: 84.7, account_id: acc("Nubank"), category_id: cat("Transporte"), date: day(m1, 24) },
    { name: "Academia", value: 89.9, account_id: acc("Nubank"), category_id: cat("Saúde"), date: day(m1, 10), fixed: true },
    { name: "Netflix", value: 44.9, account_id: acc("Nubank"), category_id: cat("Assinaturas"), date: day(m1, 12), fixed: true },
    { name: "Cinema com amigos", value: 92, account_id: acc("Nubank"), category_id: cat("Lazer"), date: day(m1, 20) },
    { name: "Curso de inglês", value: 249, account_id: acc("Itaú"), category_id: cat("Educação"), date: day(m1, 9) },
  ];

  db.transactions = rows.map((r) =>
    buildTransaction(db, {
      name: r.name,
      value: r.value,
      type: r.type ?? "despesa",
      status: r.status ?? "pago",
      date: r.date,
      account_id: r.account_id!,
      to_account_id: r.to_account_id ?? null,
      category_id: r.category_id ?? null,
      fixed: r.fixed ?? false,
      recurrence: r.fixed ? "mensal" : null,
      installment: r.installment ?? false,
      total_installments: r.total_installments ?? null,
      current_installment: r.current_installment ?? null,
      adjusted_value: null,
      attachment: null,
      notes: null,
    }),
  );
  writeDb(db);
}

export function localClearData(): void {
  const name = readDb().profile.name;
  wipeDb();
  writeDb(freshDb(name));
}

export function localGetProfile(): { name: string } {
  return readDb().profile;
}

export function localSetName(name: string): { name: string } {
  const db = readDb();
  db.profile.name = name.trim();
  writeDb(db);
  return db.profile;
}

export function localExport(): string {
  return JSON.stringify(readDb(), null, 2);
}
