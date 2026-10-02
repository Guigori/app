// Local-mode data engine: the same business rules as backend/lib/stats.py, run in
// the browser. Keep the two in sync — a rule change belongs in both places.

import { addMonth, currentMonth, todayISO } from "@/lib/format";
import { newId, readDb, writeDb, freshDb, wipeDb, type LocalCard, type LocalDb } from "@/lib/local/store";
import type {
  Account,
  AccountDetail,
  AccountInput,
  BudgetRow,
  BudgetStatus,
  BudgetSummary,
  Category,
  CategoryGroup,
  CategoryInput,
  CategorySlice,
  CalendarMonth,
  DayFlow,
  Flow,
  FlowCategory,
  FlowParams,
  FlowPoint,
  CardInput,
  CreditCard,
  NotificationItem,
  Notifications,
  Dashboard,
  RuleItem,
  RuleStatus,
  MonthTrend,
  Transaction,
  TransactionInput,
  Trends,
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
    card_id: input.type === "despesa" ? input.card_id : null,
    card_name: null,
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

// --- Analytics --------------------------------------------------------------

const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function localTrends(months: number, endMonth?: string): Trends {
  const db = readDb();
  const last = endMonth ?? currentMonth();
  const window: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) window.push(addMonth(last, -i));

  const rows: MonthTrend[] = window.map((m) => {
    let income = 0;
    let expense = 0;
    for (const tx of db.transactions) {
      const portion = monthPortion(tx, m);
      if (portion === null) continue;
      if (tx.type === "receita") income += portion;
      else expense += portion;
    }
    return {
      month: m,
      label: MONTH_ABBR[Number(m.slice(5, 7)) - 1],
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
    };
  });

  return {
    months: rows,
    total_income: round2(rows.reduce((s, r) => s + r.income, 0)),
    total_expense: round2(rows.reduce((s, r) => s + r.expense, 0)),
  };
}

export function localBudget(month: string): BudgetSummary {
  const db = readDb();
  const spentByCat = new Map<string | null, number>();
  let income = 0;
  for (const tx of db.transactions) {
    const portion = monthPortion(tx, month);
    if (portion === null) continue;
    if (tx.type === "receita") income += portion;
    else spentByCat.set(tx.category_id, (spentByCat.get(tx.category_id) ?? 0) + portion);
  }

  const rows: BudgetRow[] = [];
  for (const cat of db.categories) {
    const budget = round2(cat.monthly_budget);
    const spent = round2(spentByCat.get(cat.id) ?? 0);
    if (budget <= 0 && spent <= 0) continue;
    const percent = budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 0;
    const status: BudgetStatus =
      budget <= 0 ? "sem_limite" : percent <= 80 ? "dentro" : percent <= 100 ? "proximo" : "acima";
    rows.push({
      category_id: cat.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      group: cat.group,
      budget,
      spent,
      remaining: round2(budget - spent),
      percent,
      status,
    });
  }
  rows.sort((a, b) => Number(a.budget <= 0) - Number(b.budget <= 0) || b.percent - a.percent || b.spent - a.spent);

  const planned = round2(rows.reduce((s, r) => s + r.budget, 0));
  const spentTotal = round2(rows.reduce((s, r) => s + r.spent, 0));
  const budgetedSpent = round2(rows.filter((r) => r.budget > 0).reduce((s, r) => s + r.spent, 0));

  return {
    month,
    planned,
    spent: spentTotal,
    remaining: round2(planned - budgetedSpent),
    percent: planned ? Math.round((budgetedSpent / planned) * 1000) / 10 : 0,
    income: round2(income),
    unbudgeted_spent: round2(spentTotal - budgetedSpent),
    rows,
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
      card_id: null,
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

/** Cash-flow window for the /fluxo screen — mirrors backend/routers/analytics.py flow(). */
export function localFlow(params: FlowParams): Flow {
  const db = readDb();
  const focus = params.month ?? currentMonth();
  const window: string[] = [];
  if (params.from_month && params.to_month) {
    const [start, end] =
      params.from_month <= params.to_month
        ? [params.from_month, params.to_month]
        : [params.to_month, params.from_month];
    const span = Math.min(monthsBetween(start, end), 35);
    for (let i = 0; i <= span; i += 1) window.push(addMonth(start, i));
  } else {
    const months = params.months ?? 12;
    for (let i = months - 1; i >= 0; i -= 1) window.push(addMonth(focus, -i));
    window.push(addMonth(focus, 1), addMonth(focus, 2));
  }

  const txs = params.category_id
    ? db.transactions.filter((t) => t.category_id === params.category_id)
    : db.transactions;
  const settled = new Set(txs.map((t) => `${t.name.trim().toLowerCase()}|${t.date.slice(0, 7)}`));
  const todayMonth = todayISO().slice(0, 7);

  const amount = (t: Transaction) => round2(t.installment ? t.installment_value ?? 0 : t.value);
  const projection = (t: Transaction, month: string): number | null => {
    if (t.type === "transferencia") return null;
    const txMonth = t.date.slice(0, 7);
    if (t.status !== "pago" && txMonth === month) return amount(t);
    if (t.fixed && (t.recurrence ?? "mensal") === "mensal") {
      if (monthsBetween(txMonth, month) > 0 && !settled.has(`${t.name.trim().toLowerCase()}|${month}`)) {
        return amount(t);
      }
    }
    return null;
  };

  const series: FlowPoint[] = window.map((m) => {
    let income = 0;
    let expense = 0;
    let pIncome = 0;
    let pExpense = 0;
    for (const tx of txs) {
      const portion = monthPortion(tx, m);
      if (portion !== null) {
        if (tx.type === "receita") income += portion;
        else expense += portion;
      }
      const projected = projection(tx, m);
      if (projected !== null) {
        if (tx.type === "receita") pIncome += projected;
        else pExpense += projected;
      }
    }
    return {
      month: m,
      label: MONTH_ABBR[Number(m.slice(5, 7)) - 1],
      year: `'${m.slice(2, 4)}`,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
      projected_income: round2(pIncome),
      projected_expense: round2(pExpense),
      projected_net: round2(pIncome - pExpense),
      future: m > todayMonth,
    };
  });

  const byCat = new Map<string | null, number>();
  for (const tx of txs) {
    const portion = monthPortion(tx, focus);
    if (portion === null || tx.type === "receita") continue;
    byCat.set(tx.category_id, (byCat.get(tx.category_id) ?? 0) + portion);
  }
  const focusExpense = round2([...byCat.values()].reduce((s, v) => s + v, 0));
  const categories: FlowCategory[] = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => {
      const category = key ? db.categories.find((c) => c.id === key) : undefined;
      return {
        category_id: key,
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "#94A3B8",
        icon: category?.icon ?? "more-horizontal",
        total: round2(value),
        percent: focusExpense ? Math.round((value / focusExpense) * 1000) / 10 : 0,
      };
    });

  const point = series.find((p) => p.month === focus);
  return {
    month: focus,
    from_month: window[0],
    to_month: window[window.length - 1],
    income: point?.income ?? 0,
    expense: point?.expense ?? 0,
    net: point?.net ?? 0,
    projected_income: point?.projected_income ?? 0,
    projected_expense: point?.projected_expense ?? 0,
    projected_net: point?.projected_net ?? 0,
    total_income: round2(series.reduce((s, p) => s + p.income, 0)),
    total_expense: round2(series.reduce((s, p) => s + p.expense, 0)),
    total_net: round2(series.reduce((s, p) => s + p.net, 0)),
    series,
    categories,
  };
}

/** Per-day entradas/saídas of a month — mirrors backend calendar_month(). */
export function localCalendar(month: string): CalendarMonth {
  const db = readDb();
  const [start, end] = monthBounds(month);
  const buckets = new Map<string, DayFlow>();
  for (const tx of db.transactions) {
    if (tx.date < start || tx.date > end) continue;
    const day =
      buckets.get(tx.date) ??
      { date: tx.date, income: 0, expense: 0, projected_income: 0, projected_expense: 0, count: 0 };
    day.count += 1;
    if (tx.type !== "transferencia") {
      const value = round2(tx.installment ? tx.installment_value ?? 0 : tx.value);
      if (tx.status === "pago") {
        if (tx.type === "receita") day.income = round2(day.income + value);
        else day.expense = round2(day.expense + value);
      } else if (tx.type === "receita") {
        day.projected_income = round2(day.projected_income + value);
      } else {
        day.projected_expense = round2(day.projected_expense + value);
      }
    }
    buckets.set(tx.date, day);
  }
  const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  const income = round2(days.reduce((s, d) => s + d.income, 0));
  const expense = round2(days.reduce((s, d) => s + d.expense, 0));
  const pIncome = round2(days.reduce((s, d) => s + d.projected_income, 0));
  const pExpense = round2(days.reduce((s, d) => s + d.projected_expense, 0));
  return {
    month,
    days,
    income,
    expense,
    net: round2(income - expense),
    projected_income: pIncome,
    projected_expense: pExpense,
    projected_balance: round2(income - expense + pIncome - pExpense),
  };
}

// --- Cartões (mirror: backend/routers/cards.py + lib/cards.py) ---------------

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function shiftMonths(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const idx = year * 12 + (month - 1) + months;
  return clampDay(Math.floor(idx / 12), (idx % 12) + 1, day);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Open invoice window: day after the last closing through the next closing. */
function cycleBounds(today: string, closingDay: number): [string, string] {
  const thisClosing = clampDay(Number(today.slice(0, 4)), Number(today.slice(5, 7)), closingDay);
  if (today <= thisClosing) return [addDays(shiftMonths(thisClosing, -1), 1), thisClosing];
  return [addDays(thisClosing, 1), shiftMonths(thisClosing, 1)];
}

function dueDate(nextClosing: string, closingDay: number, dueDay: number): string {
  const sameMonth = clampDay(Number(nextClosing.slice(0, 4)), Number(nextClosing.slice(5, 7)), dueDay);
  return dueDay > closingDay ? sameMonth : shiftMonths(sameMonth, 1);
}

function buildCard(doc: LocalCard, txs: Transaction[], accounts: Account[]): CreditCard {
  const today = todayISO();
  const [start, closing] = cycleBounds(today, doc.closing_day);
  let invoice = 0;
  let future = 0;
  for (const tx of txs) {
    if (tx.card_id !== doc.id || tx.type !== "despesa") continue;
    const value = round2(tx.installment ? tx.installment_value ?? 0 : tx.value);
    if (tx.installment) {
      const total = tx.total_installments ?? 1;
      const offset = monthsBetween(tx.date.slice(0, 7), closing.slice(0, 7));
      if (offset >= 0 && offset < total) invoice += value;
      future += value * Math.max(total - Math.max(offset + 1, 0), 0);
    } else if (tx.date >= start && tx.date <= closing) {
      invoice += value;
    }
  }
  const used = round2(invoice + future);
  const account = accounts.find((a) => a.id === doc.payment_account_id);
  return {
    ...doc,
    payment_account_name: account?.name ?? null,
    current_invoice: round2(invoice),
    future_installments: round2(future),
    used,
    available: round2(Math.max(doc.limit - used, 0)),
    used_percent: doc.limit ? Math.round((used / doc.limit) * 1000) / 10 : 0,
    cycle_start: start,
    next_closing: closing,
    next_due: dueDate(closing, doc.closing_day, doc.due_day),
    best_purchase_day: addDays(closing, 1),
  };
}

export function localListCards(): CreditCard[] {
  const db = readDb();
  return db.cards.map((card) => buildCard(card, db.transactions, db.accounts));
}

export function localCreateCard(input: CardInput): CreditCard {
  const db = readDb();
  const card: LocalCard = { ...input, id: newId(), created_at: new Date().toISOString() };
  db.cards = [...db.cards, card];
  writeDb(db);
  return buildCard(card, db.transactions, db.accounts);
}

export function localUpdateCard(id: string, input: CardInput): CreditCard {
  const db = readDb();
  const existing = db.cards.find((c) => c.id === id);
  if (!existing) throw new Error("Cartão não encontrado.");
  const card: LocalCard = { ...existing, ...input };
  db.cards = db.cards.map((c) => (c.id === id ? card : c));
  writeDb(db);
  return buildCard(card, db.transactions, db.accounts);
}

export function localDeleteCard(id: string): void {
  const db = readDb();
  db.cards = db.cards.filter((c) => c.id !== id);
  db.transactions = db.transactions.map((t) => (t.card_id === id ? { ...t, card_id: null, card_name: null } : t));
  writeDb(db);
}

/** Pending/scheduled money coming due, plus invoices closing in — mirrors notifications.py. */
export function localNotifications(windowDays = 7): Notifications {
  const db = readDb();
  const today = todayISO();
  const dayDiff = (iso: string) =>
    Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);

  const items: NotificationItem[] = [];
  for (const tx of db.transactions) {
    if (tx.status === "pago") continue;
    const daysLeft = dayDiff(tx.date);
    if (daysLeft > windowDays) continue;
    const word = tx.type === "receita" ? "Receita" : tx.type === "despesa" ? "Conta" : "Transferência";
    items.push({
      id: tx.id,
      kind: daysLeft < 0 ? "atrasado" : "vencimento",
      title: `${word}: ${tx.name}`,
      description:
        daysLeft < 0
          ? `Venceu há ${Math.abs(daysLeft)} dia(s) e continua em aberto.`
          : daysLeft === 0
            ? "Vence hoje."
            : `Vence em ${daysLeft} dia(s).`,
      date: tx.date,
      value: round2(tx.value),
      days_left: daysLeft,
    });
  }
  for (const card of db.cards) {
    if (!card.active) continue;
    const [, closing] = cycleBounds(today, card.closing_day);
    const due = dueDate(closing, card.closing_day, card.due_day);
    const daysLeft = dayDiff(due);
    if (daysLeft > windowDays) continue;
    items.push({
      id: `card-${card.id}`,
      kind: "fatura",
      title: `Fatura ${card.name}`,
      description: `Fecha em ${closing.slice(8, 10)}/${closing.slice(5, 7)} e vence em ${due.slice(8, 10)}/${due.slice(5, 7)}.`,
      date: due,
      value: 0,
      days_left: daysLeft,
    });
  }
  items.sort((a, b) => a.days_left - b.days_left || a.title.localeCompare(b.title));
  return { items, count: items.length };
}
