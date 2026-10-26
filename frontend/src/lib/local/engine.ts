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
  Invoice,
  InvoiceItem,
  CreditInvoiceInput,
  NotificationItem,
  PayInvoiceInput,
  SubscriptionInput,
  SubscriptionItem,
  Subscriptions,
  Notifications,
  Dashboard,
  RuleItem,
  RuleStatus,
  MonthTrend,
  Transaction,
  TransactionInput,
  Trends,
} from "@/types/finnos";

import { spendingPace } from "@/lib/budgetPace";

/** Sanitized, append-only history. Mirrors the server record_event contract. */
function localAudit(db: LocalDb, entity: string, action: "created" | "updated" | "deleted",
  before: { id: string; name?: string; value?: number; monthly_budget?: number; date?: string } | null,
  after: { id: string; name?: string; value?: number; monthly_budget?: number; date?: string } | null): void {
  const summary = (item: typeof before) => item ? {
    ...(item.name ? { name: item.name } : {}),
    ...(item.date ? { date: item.date } : {}),
    ...(item.value != null ? { value_cents: Math.round(item.value * 100) } : {}),
    ...(item.monthly_budget != null ? { monthly_budget_cents: Math.round(item.monthly_budget * 100) } : {}),
  } : null;
  db.audit_events ??= [];
  db.audit_events.push({
    id: newId(), entity, entity_id: (after ?? before)!.id, action,
    summary: `${action}: ${entity}`, created_at: new Date().toISOString(),
    before: summary(before), after: summary(after),
  });
}

export function localFinanceHistory(limit = 50, before?: string) {
  const items = [...(readDb().audit_events ?? [])]
    .filter(item => !before || item.created_at < before)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { items: items.slice(0, limit), next_cursor: items.length > limit ? items[limit - 1]?.created_at ?? null : null };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Mirror of finnos.lib.money.installment_portion: no negative/zero installments. */
function installmentPortion(value: number, count: number, offset: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || !Number.isInteger(count) || count < 1
      || cents < 0 || offset < 0 || offset >= count) {
    throw new Error("Parcelamento inválido: cada parcela deve valer ao menos R$ 0,01.");
  }
  const base = Math.floor(cents / count);
  const remaining = cents % count;
  return (base + (offset >= count - remaining ? 1 : 0)) / 100;
}

/** First remaining installment (0-based) of a k/n purchase. */
function firstRemainingInstallment(tx: { current_installment?: number | null; total_installments?: number | null }): number {
  const n = tx.total_installments ?? 1;
  const current = tx.current_installment ?? 1;
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(current) || current < 1 || current > n) {
    throw new Error("Parcela atual inválida.");
  }
  return current - 1;
}

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
  if (tx.invoice_payment || tx.type === "transferencia" || tx.status !== "pago") return null;
  if (tx.installment) {
    const n = tx.total_installments ?? 1;
    const offset = monthsBetween(tx.date.slice(0, 7), month);
    const start = firstRemainingInstallment(tx);
    return offset >= 0 && start + offset < n ? installmentPortion(tx.value, n, start + offset) : null;
  }
  return tx.date.slice(0, 7) === month ? round2(tx.value) : null;
}

/** Signed effect on each account balance — "pago" moves money, pending/scheduled never does. */
function balanceEffects(tx: Transaction, today: string): [string, number][] {
  if (tx.card_id || tx.status !== "pago" || tx.date > today) return [];
  let v = tx.value;
  if (tx.installment) {
    const n = tx.total_installments ?? 1;
    const due = monthsBetween(tx.date.slice(0, 7), today.slice(0, 7)) + 1;
    const first = firstRemainingInstallment(tx);
    v = round2(Array.from({ length: Math.max(0, Math.min(due, n - first)) }, (_, i) => installmentPortion(tx.value, n, first + i)).reduce((total, amount) => total + amount, 0));
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

// --- Institutions -----------------------------------------------------------

export function localListInstitutions() {
  return readDb().institutions;
}

export function localCreateInstitution(input: import("@/types/finnos").InstitutionInput) {
  const db = readDb();
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || db.institutions.some(inst => inst.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    throw new Error("Instituição inválida ou já cadastrada.");
  }
  const institution = { id: newId(), name, color: input.color, created_at: new Date().toISOString() };
  db.institutions.push(institution);
  writeDb(db);
  return institution;
}

export function localDeleteInstitution(id: string) {
  const db = readDb();
  if (db.accounts.some(a => a.institution_id === id) || db.cards.some(c => c.institution_id === id)) {
    throw new Error("Instituição possui contas ou cartões vinculados.");
  }
  if (!db.institutions.some(i => i.id === id)) throw new Error("Instituição não encontrada.");
  db.institutions = db.institutions.filter(i => i.id !== id);
  writeDb(db);
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
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
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
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
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
  if (db.subscriptions.some(sub => sub.account_id === id)) throw new Error("Conta vinculada a uma assinatura.");
  if (db.cards.some(card => card.payment_account_id === id)) throw new Error("Conta vinculada a um cartão de crédito. Altere a conta de pagamento do cartão antes de excluir.");
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
  localAudit(db, "categories", "created", null, category);
  writeDb(db);
  return category;
}

export function localUpdateCategory(id: string, input: CategoryInput): Category {
  const db = readDb();
  const index = db.categories.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Categoria não encontrada.");
  const before = { ...db.categories[index] };
  db.categories[index] = { ...db.categories[index], ...input };
  localAudit(db, "categories", "updated", before, db.categories[index]);
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
  if (db.subscriptions.some(sub => sub.category_id === id)) throw new Error("Categoria vinculada a uma assinatura.");
  const previous = db.categories.find(c => c.id === id) ?? null;
  db.categories = db.categories.filter((c) => c.id !== id);
  if (previous) localAudit(db, "categories", "deleted", previous, null);
  writeDb(db);
}

// --- Transactions -----------------------------------------------------------

export interface LocalTxFilters {
  month?: string;
  start_date?: string;
  end_date?: string;
  type?: string;
  status?: string;
  category_id?: string;
  account_id?: string;
  search?: string;
}

export function localListTransactions(filters: LocalTxFilters): Transaction[] {
  const db = readDb();
  let rows = sortedTransactions(db);
  if (filters.start_date || filters.end_date) {
    if (filters.start_date) rows = rows.filter((t) => t.date >= filters.start_date!);
    if (filters.end_date) rows = rows.filter((t) => t.date <= filters.end_date!);
  } else if (filters.month) {
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
  if (input.status === "pago" && input.date > todayISO()) {
    throw new Error("Lançamento futuro não pode estar pago. Use agendado ou pendente.");
  }
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
    if (!input.total_installments || input.total_installments < 2 || input.total_installments > 120) {
      throw new Error("Informe de 2 a 120 parcelas.");
    }
    firstRemainingInstallment(input);
    if (Math.round((input.adjusted_value ?? input.value) * 100) < input.total_installments) {
      throw new Error("Cada parcela deve valer ao menos R$ 0,01.");
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
    installment_value: input.installment && input.total_installments ? installmentPortion(total, input.total_installments, (input.current_installment ?? 1) - 1) : null,
    adjusted_value: input.adjusted_value,
    attachment: input.attachment,
    notes: input.notes,
    notify_enabled: input.notify_enabled ?? true,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
}

export function localCreateTransaction(input: TransactionInput): Transaction {
  const db = readDb();
  const tx = buildTransaction(db, input);
  db.transactions.push(tx);
  localAudit(db, "transactions", "created", null, tx);
  writeDb(db);
  return enrich(db, tx);
}

/** A paid invoice locks its purchase breakdown until an audited refund exists. */
function assertPurchaseNotSettled(db: LocalDb, transaction: Transaction): void {
  if (transaction.invoice_payment) throw new Error("Pagamento de fatura não pode ser alterado manualmente.");
  if (!transaction.card_id) return;
  const card = db.cards.find(c => c.id === transaction.card_id);
  if (!card) return;
  if (Object.values(card.invoice_adjustments ?? {}).some(items => items.some(item => item.purchase_id === transaction.id))) {
    throw new Error("Compra possui estorno auditado e não pode ser alterada ou excluída.");
  }
  if (!card.paid_cycles) return;
  const firstClosing = cycleBounds(transaction.date, card.closing_day)[1];
  const count = transaction.installment ? (transaction.total_installments ?? 1) - firstRemainingInstallment(transaction) : 1;
  for (let i = 0; i < count; i++) {
    const cycle = configuredDayInMonth(firstClosing, i, card.closing_day);
    if (card.paid_cycles[cycle]?.amount) throw new Error("Compra pertence a uma fatura com pagamento; faça um estorno auditado.");
  }
}

export function localUpdateTransaction(id: string, input: TransactionInput): Transaction {
  const db = readDb();
  const index = db.transactions.findIndex((t) => t.id === id);
  if (index < 0) throw new Error("Transação não encontrada.");
  assertPurchaseNotSettled(db, db.transactions[index]);
  const tx = buildTransaction(db, input, db.transactions[index]);
  const before = { ...db.transactions[index] };
  db.transactions[index] = tx;
  localAudit(db, "transactions", "updated", before, tx);
  writeDb(db);
  return enrich(db, tx);
}

export function localDeleteTransaction(id: string): void {
  const db = readDb();
  const existing = db.transactions.find(t => t.id === id);
  if (existing) assertPurchaseNotSettled(db, existing);
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
    const pace = spendingPace(
      budget,
      db.transactions.filter(tx => tx.category_id === cat.id && tx.type === "despesa")
        .map(tx => ({ date: tx.date, amount: monthPortion(tx, month) ?? 0 }))
        .filter(event => event.amount > 0),
      month,
      todayISO(),
    );
    rows.push({
      ...pace,
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
  const todayMonth = todayISO().slice(0, 7);

  const amount = (t: Transaction) => round2(t.installment ? t.installment_value ?? 0 : t.value);
  const recurrenceKey = (t: Transaction): string => JSON.stringify([
    t.type, t.account_id, t.card_id, t.category_id, t.name.trim().toLowerCase(),
  ]);
  const recurringSources = (month: string): Transaction[] => {
    const present = new Set<string>();
    const latest = new Map<string, Transaction>();
    for (const tx of txs) {
      if (tx.invoice_payment || tx.type === "transferencia") continue;
      const key = recurrenceKey(tx);
      const txMonth = tx.date.slice(0, 7);
      if (txMonth === month) present.add(key);
      if (!tx.fixed || tx.installment || (tx.recurrence ?? "mensal") !== "mensal" || txMonth >= month) continue;
      const prev = latest.get(key);
      if (!prev || tx.date > prev.date) latest.set(key, tx);
    }
    return [...latest.entries()].filter(([key]) => !present.has(key)).map(([, tx]) => tx);
  };
  const projection = (t: Transaction, month: string): number | null => {
    if (t.type === "transferencia" || t.invoice_payment) return null;
    return t.status !== "pago" && t.date.slice(0, 7) === month ? amount(t) : null;
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
    for (const source of recurringSources(m)) {
      if (source.type === "receita") pIncome += amount(source);
      else pExpense += amount(source);
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
      { date: tx.date, income: 0, expense: 0, projected_income: 0, projected_expense: 0, count: 0, active_count: 0 };
    day.count += 1;
    if (tx.type !== "transferencia" && !tx.invoice_payment) {
      const value = round2(tx.installment ? installmentPortion(tx.value, tx.total_installments ?? 1, firstRemainingInstallment(tx)) : tx.value);
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

/** Advance from a configured closing/day, preserving 29–31 through February. */
function configuredDayInMonth(iso: string, months: number, day: number): string {
  const index = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + months;
  return clampDay(Math.floor(index / 12), index % 12 + 1, day);
}

/** Open invoice window: day after last closing through next closing. */
function cycleBounds(today: string, closingDay: number): [string, string] {
  const thisClosing = configuredDayInMonth(today, 0, closingDay);
  if (today <= thisClosing) return [addDays(configuredDayInMonth(today, -1, closingDay), 1), thisClosing];
  return [addDays(thisClosing, 1), configuredDayInMonth(today, 1, closingDay)];
}

function dueDate(nextClosing: string, closingDay: number, dueDay: number): string {
  const sameMonth = clampDay(Number(nextClosing.slice(0, 4)), Number(nextClosing.slice(5, 7)), dueDay);
  return dueDay > closingDay ? sameMonth : configuredDayInMonth(nextClosing, 1, dueDay);
}

/** Match Firestore: credit spending affects the card limit, not the bank balance. */
function buildCard(doc: LocalCard, txs: Transaction[], accounts: Account[]): CreditCard {
  const today = todayISO();
  const [start, closing] = cycleBounds(today, doc.closing_day);
  const purchaseLines = new Map<string, Map<string, number>>();
  for (const tx of txs) {
    if (tx.card_id !== doc.id || tx.type !== "despesa") continue;
    const firstClosing = cycleBounds(tx.date, doc.closing_day)[1];
    const n = tx.installment ? (tx.total_installments ?? 1) : 1;
    const first = tx.installment ? firstRemainingInstallment(tx) : 0;
    for (let offset = 0; first + offset < n; offset++) {
      const key = configuredDayInMonth(firstClosing, offset, doc.closing_day);
      const value = tx.installment ? installmentPortion(tx.value, n, first + offset) : tx.value;
      if (!purchaseLines.has(key)) purchaseLines.set(key, new Map());
      purchaseLines.get(key)!.set(tx.id, value);
    }
  }
  const paidCycles = doc.paid_cycles ?? {};
  for (const [cycle, paid] of Object.entries(paidCycles)) {
    if (!purchaseLines.has(cycle)) purchaseLines.set(cycle, new Map());
    for (const item of paid.items ?? []) purchaseLines.get(cycle)!.set(item.id, item.value);
  }
  const totals = new Map([...purchaseLines].map(([cycle, purchases]) => [
    cycle, round2([...purchases.values()].reduce((sum, value) => sum + value, 0)),
  ]));
  for (const [cycle, credits] of Object.entries(doc.invoice_adjustments ?? {})) {
    const creditTotal = credits.reduce((sum, item) => sum + item.value, 0);
    totals.set(cycle, round2((totals.get(cycle) ?? 0) - creditTotal));
  }
  let used = 0, future = 0;
  for (const [cycle, total] of totals) {
    const outstanding = round2(Math.max(0, total - (paidCycles[cycle]?.amount ?? 0)));
    used = round2(used + outstanding);
    if (cycle > closing) future = round2(future + outstanding);
  }
  const invoice = round2(Math.max(0, (totals.get(closing) ?? 0) - (paidCycles[closing]?.amount ?? 0)));
  const account = accounts.find((a) => a.id === doc.payment_account_id);
  return {
    ...doc,
    payment_account_name: account?.name ?? null,
    invoice_paid: (totals.get(closing) ?? 0) > 0 && invoice === 0,
    current_invoice: invoice,
    future_installments: future,
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
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
  const card: LocalCard = { ...input, id: newId(), created_at: new Date().toISOString() };
  db.cards = [...db.cards, card];
  writeDb(db);
  return buildCard(card, db.transactions, db.accounts);
}

export function localUpdateCard(id: string, input: CardInput): CreditCard {
  const db = readDb();
  const existing = db.cards.find((c) => c.id === id);
  if (!existing) throw new Error("Cartão não encontrado.");
  if (existing.paid_cycles && Object.keys(existing.paid_cycles).length && (existing.closing_day !== input.closing_day || existing.due_day !== input.due_day)) {
    throw new Error("Não é possível mudar o ciclo de um cartão com pagamentos registrados.");
  }
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
  const card: LocalCard = { ...existing, ...input };
  db.cards = db.cards.map((c) => (c.id === id ? card : c));
  writeDb(db);
  return buildCard(card, db.transactions, db.accounts);
}

export function localDeleteCard(id: string): void {
  const db = readDb();
  if (db.subscriptions.some(sub => sub.card_id === id)) throw new Error("Cartão vinculado a uma assinatura.");
  if (db.transactions.some(tx => tx.card_id === id || (tx.invoice_payment && tx.notes?.includes(id)))) {
    throw new Error("Cartão possui compras vinculadas. Não é permitido perder o histórico da fatura.");
  }
  const card = db.cards.find(c => c.id === id);
  if (card?.paid_cycles && Object.keys(card.paid_cycles).length) {
    throw new Error("Cartão possui histórico de pagamentos.");
  }
  db.cards = db.cards.filter((c) => c.id !== id);
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
    if (tx.status === "pago" || tx.notify_enabled === false) continue;
    const daysLeft = dayDiff(tx.date);
    if (daysLeft > windowDays) continue;
    const word = tx.type === "receita" ? "Receita" : tx.type === "despesa" ? "Conta" : "Transferência";
    items.push({
      id: `tx-${tx.id}-${tx.date}`,
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
      target_url: `/transacoes?date=${tx.date}&highlight=${encodeURIComponent(tx.id)}`,
    });
  }
  for (const card of db.cards) {
    if (!card.active) continue;
    const [, closing] = cycleBounds(today, card.closing_day);
    const due = dueDate(closing, card.closing_day, card.due_day);
    const daysLeft = dayDiff(due);
    if (daysLeft > windowDays) continue;
    items.push({
      id: `card-${card.id}-${due}`,
      kind: "fatura",
      title: `Fatura ${card.name}`,
      description: `Fecha em ${closing.slice(8, 10)}/${closing.slice(5, 7)} e vence em ${due.slice(8, 10)}/${due.slice(5, 7)}.`,
      date: due,
      value: 0,
      days_left: daysLeft,
      target_url: `/cartoes/${card.id}?due=${due}`,
    });
  }
  items.sort((a, b) => a.days_left - b.days_left || a.title.localeCompare(b.title));
  return { items, count: items.length };
}

// --- Fatura detalhada / pagamento / assinaturas (modo local) ----------------

/** Invoice occurrences mirror finnos.lib.invoices.occurrences, including after-closing purchases. */
function cycleItems(card: LocalCard, txs: Transaction[], start: string, closing: string, cats: Category[]): InvoiceItem[] {
  const frozen = card.paid_cycles?.[closing]?.items ?? [];
  const items: InvoiceItem[] = [];
  for (const tx of txs) {
    if (tx.card_id !== card.id || tx.type !== "despesa") continue;
    const firstClosing = cycleBounds(tx.date, card.closing_day)[1];
    const total = tx.installment ? tx.total_installments ?? 1 : 1;
    const offset = monthsBetween(firstClosing.slice(0, 7), closing.slice(0, 7));
    const first = tx.installment ? firstRemainingInstallment(tx) : 0;
    if (offset < 0 || first + offset >= total || configuredDayInMonth(firstClosing, offset, card.closing_day) !== closing) continue;
    const category = cats.find((c) => c.id === tx.category_id);
    items.push({
      id: tx.id,
      name: tx.name,
      date: tx.date,
      value: tx.installment ? installmentPortion(tx.value, total, first + offset) : tx.value,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
      installment_label: total > 1 ? `${first + offset + 1}/${total}` : null,
    });
  }
  const seen = new Set(frozen.map(item => item.id));
  return [...frozen, ...items.filter(item => !seen.has(item.id))]
    .sort((a, b) => b.date.localeCompare(a.date));
}
function invoiceForCycle(db: LocalDb, card: LocalCard, closing: string): Invoice {
  if (closing !== configuredDayInMonth(closing, 0, card.closing_day)) {
    throw new Error("Ciclo de fatura inválido.");
  }
  const start = addDays(configuredDayInMonth(closing, -1, card.closing_day), 1);
  const items = cycleItems(card, db.transactions, start, closing, db.categories);
  const payment = card.paid_cycles?.[closing];
  const adjustments = card.invoice_adjustments?.[closing] ?? [];
  const adjustmentTotal = round2(adjustments.reduce((sum, item) => sum + item.value, 0));
  const total = round2(items.reduce((sum, item) => sum + item.value, 0) - adjustmentTotal);
  const paidAmount = round2(payment?.amount ?? 0);
  return {
    card_id: card.id,
    card_name: card.name,
    cycle_start: start,
    cycle_end: closing,
    due_date: dueDate(closing, card.closing_day, card.due_day),
    total,
    paid: total > 0 && paidAmount === total,
    outstanding: round2(Math.max(0, total - paidAmount)),
    paid_amount: paidAmount,
    paid_at: payment?.paid_at ?? null,
    items,
    adjustments,
    adjustment_total: adjustmentTotal,
  };
}

function defaultLocalInvoiceCycle(db: LocalDb, card: LocalCard): string {
  const today = todayISO();
  const open = cycleBounds(today, card.closing_day)[1];
  const cycles = new Set<string>([
    ...Object.keys(card.paid_cycles ?? {}),
    ...Object.keys(card.invoice_adjustments ?? {}),
  ]);
  for (const tx of db.transactions) {
    if (tx.card_id !== card.id || tx.type !== "despesa") continue;
    const first = cycleBounds(tx.date, card.closing_day)[1];
    const count = tx.installment ? (tx.total_installments ?? 1) - firstRemainingInstallment(tx) : 1;
    for (let offset = 0; offset < count; offset++) {
      const closing = configuredDayInMonth(first, offset, card.closing_day);
      if (closing < today) cycles.add(closing);
    }
  }
  for (const cycle of [...cycles].filter(cycle => cycle < today).sort()) {
    if ((invoiceForCycle(db, card, cycle).outstanding ?? 0) > 0) return cycle;
  }
  return open;
}

export function localInvoice(cardId: string, selectedCycle?: string): Invoice {
  const db = readDb();
  const card = db.cards.find(item => item.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  return invoiceForCycle(db, card, selectedCycle ?? defaultLocalInvoiceCycle(db, card));
}

export function localPayInvoice(cardId: string, input: PayInvoiceInput): Invoice {
  const db = readDb();
  const card = db.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  if (!db.accounts.some((a) => a.id === input.account_id)) throw new Error("Conta inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date + "T12:00:00")) || input.date > todayISO()) {
    throw new Error("A data do pagamento precisa ser válida e não pode estar no futuro.");
  }
  const closing = input.cycle ?? defaultLocalInvoiceCycle(db, card);
  if (closing !== configuredDayInMonth(closing, 0, card.closing_day)) throw new Error("Ciclo de fatura inválido.");
  const first = configuredDayInMonth(closing, -1, card.closing_day);
  const start = addDays(first, 1);
  const items = cycleItems(card, db.transactions, start, closing, db.categories);
  const total = invoiceForCycle(db, card, closing).total;
  const previous = card.paid_cycles?.[closing]?.amount ?? 0;
  const outstanding = round2(total - previous);
  const amount = round2(input.value ?? outstanding);
  if (outstanding <= 0) throw new Error("Esta fatura já foi quitada ou não possui compras.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) throw new Error("Pagamento deve ser positivo e não ultrapassar o saldo da fatura.");

  // A settlement is a bank debit; never add a duplicate category expense.
  const debit = buildTransaction(db, {
    name: `Fatura ${card.name}`, value: amount,
    type: "despesa", status: "pago", date: input.date,
    account_id: input.account_id, card_id: null, to_account_id: null,
    category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, adjusted_value: null,
    attachment: null, notes: `Pagamento da fatura fechada em ${closing}.`,
  });
  debit.invoice_payment = true;
  db.transactions = [...db.transactions, debit];
  card.paid_cycles = {
    ...card.paid_cycles,
    [closing]: { amount: round2(previous + amount), paid_at: input.date, items },
  };
  db.cards = db.cards.map((c) => c.id === cardId ? card : c);
  writeDb(db);
  return localInvoice(cardId, closing);
}


/** Append-only merchant credit in local mode; no simulated bank reimbursement. */
export function localCreditInvoice(cardId: string, input: CreditInvoiceInput, operationId: string): Invoice {
  const db = readDb();
  const card = db.cards.find(item => item.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  if (!operationId || operationId.length > 200) throw new Error("Identificador de operação inválido.");
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new Error("Descreva o motivo do estorno.");
  const valueCents = Math.round(input.value * 100);
  if (!Number.isSafeInteger(valueCents) || valueCents <= 0 || Math.abs(input.value * 100 - valueCents) > 1e-6) {
    throw new Error("O valor do estorno deve ter no máximo duas casas decimais.");
  }
  const id = `${cardId}:${operationId}`;
  const fingerprint = JSON.stringify({
    cardId, cycle: input.cycle, purchaseId: input.purchase_id, amountCents: valueCents, reason,
  });
  const previous = Object.values(card.invoice_adjustments ?? {}).flat()
    .find(item => item.id === id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error("Identificador reutilizado para outro estorno.");
    return invoiceForCycle(db, card, input.cycle);
  }
  const invoice = invoiceForCycle(db, card, input.cycle);
  const purchase = invoice.items.find(item => item.id === input.purchase_id);
  if (!purchase) throw new Error("Compra não encontrada nesta fatura.");
  const priorCents = (invoice.adjustments ?? [])
    .filter(item => item.purchase_id === input.purchase_id)
    .reduce((total, item) => total + Math.round(item.value * 100), 0);
  if (priorCents + valueCents > Math.round(purchase.value * 100)) {
    throw new Error("O estorno excede o valor ainda disponível dessa compra.");
  }
  if (valueCents > Math.round((invoice.outstanding ?? 0) * 100)) {
    throw new Error("O estorno excede o saldo não pago. Faturas quitadas exigem reembolso bancário.");
  }
  card.invoice_adjustments = {
    ...card.invoice_adjustments,
    [input.cycle]: [
      ...(card.invoice_adjustments?.[input.cycle] ?? []),
      {
        id, purchase_id: input.purchase_id, date: todayISO(),
        reason, value: valueCents / 100, fingerprint,
      },
    ],
  };
  localAudit(db, "cards", "updated", { id: card.id, name: card.name }, { id: card.id, name: card.name });
  writeDb(db);
  return invoiceForCycle(db, card, input.cycle);
}

/** Subscriptions are independent from fixed transactions in local and demo mode. */
function nextSubscriptionCharge(anchor: string, recurrence: "mensal" | "anual"): string {
  const today = todayISO();
  if (anchor >= today) return anchor;
  const [year, month, day] = anchor.split("-").map(Number);
  if (recurrence === "anual") {
    let current = clampDay(Number(today.slice(0, 4)), month, day);
    if (current < today) current = clampDay(Number(today.slice(0, 4)) + 1, month, day);
    return current;
  }
  const offset = Math.max(0, (Number(today.slice(0, 4)) - year) * 12 + Number(today.slice(5, 7)) - month);
  const dateAt = (i: number) => {
    const index = year * 12 + month - 1 + i;
    return clampDay(Math.floor(index / 12), index % 12 + 1, day);
  };
  const current = dateAt(offset);
  return current < today ? dateAt(offset + 1) : current;
}

function validateLocalSubscription(input: SubscriptionInput): void {
  const db = readDb();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.next_charge) && !Number.isNaN(Date.parse(input.next_charge + "T12:00:00"));
  if (!input.name.trim() || !Number.isFinite(input.value) || input.value <= 0 || !validDate) {
    throw new Error("Nome, valor e data da assinatura são obrigatórios.");
  }
  if (!db.accounts.some(account => account.id === input.account_id)) throw new Error("Conta inválida.");
  if (input.category_id && !db.categories.some(category => category.id === input.category_id)) throw new Error("Categoria inválida.");
  if (input.card_id && !db.cards.some(card => card.id === input.card_id)) throw new Error("Cartão inválido.");
}

function buildLocalSubscription(id: string, input: SubscriptionInput | SubscriptionItem): SubscriptionItem {
  const db = readDb();
  const category = db.categories.find(item => item.id === input.category_id);
  const card = db.cards.find(item => item.id === input.card_id);
  return {
    ...input, id,
    name: input.name.trim(),
    notes: input.notes ?? null,
    account_name: db.accounts.find(item => item.id === input.account_id)?.name ?? "",
    category_name: category?.name ?? null,
    category_color: category?.color ?? null,
    card_name: card?.name ?? null,
  };
}

export function localCreateSubscription(input: SubscriptionInput): SubscriptionItem {
  validateLocalSubscription(input);
  const db = readDb();
  const item = buildLocalSubscription(newId(), input);
  db.subscriptions = [...db.subscriptions, item];
  writeDb(db);
  return item;
}

export function localUpdateSubscription(id: string, input: SubscriptionInput): SubscriptionItem {
  validateLocalSubscription(input);
  const db = readDb();
  if (!db.subscriptions.some(sub => sub.id === id)) throw new Error("Assinatura não encontrada.");
  const item = buildLocalSubscription(id, input);
  db.subscriptions = db.subscriptions.map(sub => sub.id === id ? item : sub);
  writeDb(db);
  return item;
}

export function localDeleteSubscription(id: string): void {
  const db = readDb();
  if (!db.subscriptions.some(sub => sub.id === id)) throw new Error("Assinatura não encontrada.");
  db.subscriptions = db.subscriptions.filter(sub => sub.id !== id);
  writeDb(db);
}

export function localSubscriptions(): Subscriptions {
  const db = readDb();
  const items = db.subscriptions.map(sub => buildLocalSubscription(sub.id, sub))
    .map(sub => ({...sub, next_charge: nextSubscriptionCharge(sub.next_charge, sub.recurrence as "mensal" | "anual")}))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.next_charge.localeCompare(b.next_charge));
  const yearly = round2(items.reduce((sum, sub) => sum + (sub.active ? sub.value * (sub.recurrence === "mensal" ? 12 : 1) : 0), 0));
  const monthly = round2(yearly / 12);
  const month = todayISO().slice(0, 7);
  const income = round2(db.transactions.filter(tx =>
    tx.type === "receita" && tx.status === "pago" && tx.date.startsWith(month)
  ).reduce((sum, tx) => sum + tx.value, 0));
  return {
    items, monthly_total: monthly, yearly_total: yearly,
    income_percent: income ? round2(monthly / income * 100) : 0,
  };
}
