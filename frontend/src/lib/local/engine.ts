// Local-mode data engine: the same business rules as backend/lib/stats.py, run in
// the browser. Keep the two in sync — a rule change belongs in both places.

import { checkFunds } from "@/lib/funds";
import { matchLines, originKey, type MatchLine } from "@/lib/statementMatching";
import { institutionIdentity } from "@/lib/institutionCatalog";
import { accountScope, effectiveDefaults } from "@/lib/walletDefaults";
import { institutionKey } from "@/lib/institutionGroups";
import { addMonth, currentMonth, todayISO, toLocalISO } from "@/lib/format";
import { newId, readDb, writeDb, freshDb, wipeDb, type LocalCard, type LocalDb, type LocalPaidCycle } from "@/lib/local/store";
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
  BalanceHistory,
  CalendarMonth,
  DayFlow,
  PlannedCharge,
  UpcomingItem,
  UpcomingKind,
  Flow,
  FlowCategory,
  FlowParams,
  FlowPoint,
  CardInput,
  CreditCard,
  Invoice,
  InvoiceItem,
  CreditInvoiceInput,
  BankRefundInput,
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
  Reconciliation, ReconciliationInput, ReconResolveInput, ReconEvent, BalanceAdjustment, BalanceAdjustmentInput,
} from "@/types/finnos";

import { spendingPace } from "@/lib/budgetPace";
import { roundBRL } from "@/lib/roundMoney";
import { localCreditEvents, creditsForMonth } from "@/lib/local/competency";
import { localSubscriptionProjections, subscriptionsInCategory } from "@/lib/local/subscriptionProjection";

/** Sanitized, append-only history. Mirrors the server record_event contract. */
type AuditItem = { id: string; name?: string; value?: number; monthly_budget?: number; date?: string };
const AUDIT_FIELDS = ["status", "type", "category_id", "card_id", "account_id", "to_account_id", "origin"] as const;
function localAudit(db: LocalDb, entity: string, action: "created" | "updated" | "deleted", before: AuditItem | null, after: AuditItem | null): void {
  const summary = (item: AuditItem | null) => item ? {
    ...(item.name ? { name: item.name } : {}),
    ...(item.date ? { date: item.date } : {}),
    ...(item.value != null ? { value_cents: Math.round(item.value * 100) } : {}),
    ...(item.monthly_budget != null ? { monthly_budget_cents: Math.round(item.monthly_budget * 100) } : {}),
    ...Object.fromEntries(AUDIT_FIELDS.map((k) => [k, (item as unknown as Record<string, unknown>)[k]]).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])),
  } : null;
  db.audit_events ??= [];
  db.audit_events.push({
    id: newId(), entity, entity_id: (after ?? before)!.id, action,
    summary: `${action}: ${entity}`, created_at: new Date().toISOString(),
    before: summary(before), after: summary(after),
  });
}

/** One lançamento's recorded changes, newest first. */
export function localTransactionHistory(id: string) {
  return { items: [...(readDb().audit_events ?? [])].filter((e) => e.entity === "transactions" && e.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

export function localFinanceHistory(limit = 50, before?: string) {
  const items = [...(readDb().audit_events ?? [])]
    .filter(item => !before || item.created_at < before)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { items: items.slice(0, limit), next_cursor: items.length > limit ? items[limit - 1]?.created_at ?? null : null };
}

const round2 = roundBRL;

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

/** Mirror of finnos.lib.money.installment_schedule: [YYYY-MM-DD, index] per
 * remaining installment, on the purchase day of each following month,
 * clamped to that month's last day (AUD-04 shared contract). */
export function installmentSchedule(tx: Pick<Transaction, "date"> &
  Partial<Pick<Transaction, "current_installment" | "total_installments">>): [string, number][] {
  const n = tx.total_installments ?? 1;
  const first = firstRemainingInstallment(tx);
  const year = Number(tx.date.slice(0, 4));
  const month = Number(tx.date.slice(5, 7));
  const day = Number(tx.date.slice(8, 10));
  return Array.from({ length: n - first }, (_, offset) => {
    const idx = year * 12 + month - 1 + offset;
    return [clampDay(Math.floor(idx / 12), (idx % 12) + 1, day), first + offset] as [string, number];
  });
}

/** Mirror of analytics._unpaid_portion: expected amount of a pending/scheduled
 * entry in `month`; a parcelado series contributes the installment dated there. */
function unpaidPortion(tx: Transaction, month: string): number | null {
  if (tx.status === "pago") return null;
  if (tx.installment) {
    const hit = installmentSchedule(tx).find(([when]) => when.slice(0, 7) === month);
    return hit ? installmentPortion(tx.value, tx.total_installments ?? 1, hit[1]) : null;
  }
  return tx.date.slice(0, 7) === month ? occurrenceAmount(tx) : null;
}

/** One occurrence, including imported k/n rows without installment_value.
 * Mirror: finnos.lib.transaction_amount.occurrence_amount. Never project a
 * missing installment as R$ 0,00; preserve an explicitly stored legacy value.
 */
export function occurrenceAmount(tx: Pick<Transaction, "value"> &
  Partial<Pick<Transaction, "installment" | "total_installments" | "current_installment" | "installment_value">>): number {
  if (!tx.installment) return round2(tx.value);
  if (tx.installment_value != null) return round2(tx.installment_value);
  return installmentPortion(tx.value, tx.total_installments ?? 1, firstRemainingInstallment(tx));
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
  if ((tx.invoice_payment || tx.balance_adjustment) || tx.invoice_refund || tx.type === "transferencia" || tx.status !== "pago") return null;
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
    // Only installments whose own date has arrived are realized (AUD-04).
    const n = tx.total_installments ?? 1;
    v = round2(installmentSchedule(tx).filter(([when]) => when <= today)
      .reduce((total, [, index]) => total + installmentPortion(tx.value, n, index), 0));
  }
  if (tx.type === "receita") return [[tx.account_id, round2(v)]];
  if (tx.type === "despesa") return [[tx.account_id, round2(-v)]];
  const effects: [string, number][] = [[tx.account_id, round2(-v)]];
  if (tx.to_account_id && tx.to_account_id !== tx.account_id) effects.push([tx.to_account_id, round2(v)]);
  return effects;
}

function accountBalance(db: LocalDb, accountId: string, excludeId?: string): number {
  const today = todayISO();
  const account = db.accounts.find(a => a.id === accountId);
  let total = account?.initial_balance ?? 0;
  for (const tx of db.transactions) {
    if (tx.id === excludeId) continue;
    for (const [id, amount] of balanceEffects(tx, today)) if (id === accountId) total += amount;
  }
  return round2(total);
}

function assertNotReversed(tx: Transaction): void {
  if (tx.reversed_by || tx.reversal_of) throw new Error("Transferência desfeita fica no histórico como está; não pode ser editada nem excluída.");
}

const TRANSFER_KEYS = ["value", "account_id", "to_account_id", "status", "date", "type"] as const;

/** Same rule as the server: a paid transfer may not overdraw the source. */
function assertTransferFunds(db: LocalDb, tx: Transaction, allowOverdraft: boolean, original?: Transaction): void {
  if (tx.type !== "transferencia" || tx.status !== "pago" || tx.date > todayISO()) return;
  if (original && TRANSFER_KEYS.every(key => original[key] === tx[key])) return;
  const account = db.accounts.find(a => a.id === tx.account_id);
  if (!account) return;
  checkFunds(accountBalance(db, account.id, original?.id), tx.value, account, allowOverdraft);
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
  const institutions = new Map(db.institutions.map((i) => [i.id, i]));
  const defaults = effectiveDefaults(db.accounts, (a) => accountScope(a.type));
  return db.accounts.map((a) => ({
    ...a,
    // The institution decides the name and color shown.
    institution: institutions.get(a.institution_id ?? "")?.name ?? a.institution,
    color: institutions.get(a.institution_id ?? "")?.color ?? a.color,
    is_default: defaults.has(a.id),
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
  const identity = institutionIdentity(input.name ?? "", input.catalog_id);
  if (identity.name.length < 2) throw new Error("Informe o nome da instituição.");
  // The same name is already registered: hand it back instead of a duplicate.
  const existing = db.institutions.find((inst) => institutionKey(inst.name) === institutionKey(identity.name));
  if (existing) return existing;
  const institution = { id: newId(), ...identity, created_at: new Date().toISOString() };
  db.institutions.push(institution);
  writeDb(db);
  return institution;
}

/** Fill institution_id from a typed bank name (cash has no institution). */
function localResolveInstitution<T extends { institution: string; institution_id?: string | null; type?: string }>(input: T, isCard: boolean): T {
  if (input.institution_id || (!isCard && input.type === "carteira")) return input;
  const name = (input.institution ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return input;
  const institution = localCreateInstitution({ name });
  return { ...input, institution: institution.name, institution_id: institution.id };
}

/** Exactly one default per kind; the previous one loses the flag. */
function applyDefault<T extends { id: string; is_default?: boolean }>(items: T[], id: string, sameScope: (item: T) => boolean): T[] {
  return items.map((item) => (item.id === id ? { ...item, is_default: true } : sameScope(item) ? { ...item, is_default: false } : item));
}

export function localSetDefaultAccount(id: string): Account {
  const db = readDb();
  const target = db.accounts.find((a) => a.id === id);
  if (!target) throw new Error("Conta não encontrada.");
  db.accounts = applyDefault(db.accounts, id, (a) => accountScope(a.type) === accountScope(target.type));
  writeDb(db);
  return enrichedAccounts(db).find((a) => a.id === id)!;
}

export function localSetDefaultCard(id: string): CreditCard {
  const db = readDb();
  if (!db.cards.some((c) => c.id === id)) throw new Error("Cartão não encontrado.");
  db.cards = applyDefault(db.cards, id, () => true);
  writeDb(db);
  return localListCards().find((c) => c.id === id)!;
}

/** Link accounts and cards that only carry the bank name as text. Idempotent. */
export function localLinkLegacyInstitutions() {
  const before = readDb().institutions.length;
  let linked_accounts = 0, linked_cards = 0;
  for (const account of readDb().accounts) {
    if (account.institution_id || account.type === "carteira" || (account.institution ?? "").trim().length < 2) continue;
    const resolved = localResolveInstitution(account, false);
    const db = readDb();
    db.accounts = db.accounts.map((a) => (a.id === account.id ? { ...a, institution_id: resolved.institution_id } : a));
    writeDb(db);
    linked_accounts += 1;
  }
  for (const card of readDb().cards) {
    if (card.institution_id || (card.institution ?? "").trim().length < 2) continue;
    const resolved = localResolveInstitution(card, true);
    const db = readDb();
    db.cards = db.cards.map((c) => (c.id === card.id ? { ...c, institution_id: resolved.institution_id } : c));
    writeDb(db);
    linked_cards += 1;
  }
  return { linked_accounts, linked_cards, created_institutions: readDb().institutions.length - before };
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

export function localCreateAccount(raw: AccountInput): Account {
  const input = localResolveInstitution(raw, false);
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
  if (input.is_default) db.accounts = applyDefault(db.accounts, account.id, (a) => accountScope(a.type) === accountScope(input.type));
  writeDb(db);
  return enrichedAccounts(db).find((a) => a.id === account.id)!;
}

export function localUpdateAccount(id: string, raw: AccountInput): Account {
  const input = localResolveInstitution(raw, false);
  const db = readDb();
  const index = db.accounts.findIndex((a) => a.id === id);
  if (index < 0) throw new Error("Conta não encontrada.");
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
  const { is_default, ...fields } = input;
  db.accounts[index] = { ...db.accounts[index], ...fields, ...(is_default === undefined ? {} : { is_default }) };
  if (is_default) db.accounts = applyDefault(db.accounts, id, (a) => accountScope(a.type) === accountScope(input.type));
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
    origin: input.origin?.trim() || null,
    notify_enabled: input.notify_enabled ?? true,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
}

export function localCreateTransaction(input: TransactionInput): Transaction {
  const db = readDb();
  const tx = buildTransaction(db, input);
  assertTransferFunds(db, tx, Boolean(input.allow_overdraft));
  db.transactions.push(tx);
  localAudit(db, "transactions", "created", null, tx);
  writeDb(db);
  return enrich(db, tx);
}

/** A paid invoice locks its purchase breakdown until an audited refund exists. */
function assertPurchaseNotSettled(db: LocalDb, transaction: Transaction): void {
  if ((transaction.invoice_payment || transaction.balance_adjustment) || transaction.invoice_refund) throw new Error("Movimento de fatura não pode ser alterado manualmente.");
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
  assertNotReversed(db.transactions[index]);
  const tx = buildTransaction(db, input, db.transactions[index]);
  assertTransferFunds(db, tx, Boolean(input.allow_overdraft), db.transactions[index]);
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
  if (existing) assertNotReversed(existing);
  db.transactions = db.transactions.filter((t) => t.id !== id);
  if (existing) localAudit(db, "transactions", "deleted", existing, null);
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
  const creditEvents = localCreditEvents(db);

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

  for (const event of creditsForMonth(creditEvents, m)) {
    expense -= event.amount;
    const category = event.category_id ? db.categories.find(item => item.id === event.category_id) : undefined;
    byCategory.set(event.category_id, (byCategory.get(event.category_id) ?? 0) - event.amount);
    if (category) byGroup[category.group] -= event.amount;
  }
  for (const event of creditsForMonth(creditEvents, prev)) prevExpense -= event.amount;
  income = round2(income);
  expense = round2(expense);

  // Negative category balances from refunds remain in net expense and budget,
  // but SVG donut wedges must represent only nonnegative spend.
  const positiveCategoryTotal = [...byCategory.values()]
    .reduce((sum, value) => sum + Math.max(0, value), 0);
  const categories: CategorySlice[] = [...byCategory.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([catId, total]) => {
      const category = catId ? db.categories.find((c) => c.id === catId) : undefined;
      return {
        category_id: catId,
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "#94A3B8",
        icon: category?.icon ?? "more-horizontal",
        total: round2(total),
        percent: positiveCategoryTotal ? Math.round((total / positiveCategoryTotal) * 1000) / 10 : 0,
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

  const creditEvents = localCreditEvents(db);
  const rows: MonthTrend[] = window.map((m) => {
    let income = 0;
    let expense = 0;
    for (const tx of db.transactions) {
      const portion = monthPortion(tx, m);
      if (portion === null) continue;
      if (tx.type === "receita") income += portion;
      else expense += portion;
    }
    expense -= creditsForMonth(creditEvents, m).reduce((total, item) => total + item.amount, 0);
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

  const credits = creditsForMonth(localCreditEvents(db), month);
  for (const event of credits) {
    spentByCat.set(event.category_id, (spentByCat.get(event.category_id) ?? 0) - event.amount);
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
        .filter(event => event.amount > 0)
        .concat(credits.filter(event => event.category_id === cat.id).map(event => ({
          date: event.date, amount: -event.amount,
        }))),
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
      // Demo rows use fixed days of the current month; ones still ahead of today are scheduled, never paid.
      status: r.status ?? (r.date > todayISO() ? "agendado" : "pago"),
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

  // A card purchase carries the account that pays its invoice.
  const txs = db.transactions.filter((t) =>
    (!params.category_id || t.category_id === params.category_id)
    && (!params.account_id || t.account_id === params.account_id));
  // With an account, a refund counts only when its purchase is that account's.
  const creditEvents = localCreditEvents(params.account_id ? { cards: db.cards, transactions: txs } : db)
    .filter(item => !params.category_id || item.category_id === params.category_id);
  const subscriptions = subscriptionsInCategory(db.subscriptions, params.category_id, db.categories.find(c => c.id === params.category_id)?.name)
    .filter((sub) => !params.account_id || sub.account_id === params.account_id);
  const todayMonth = todayISO().slice(0, 7);

  const amount = occurrenceAmount;
  const recurrenceKey = (t: Transaction): string => JSON.stringify([
    t.type, t.account_id, t.card_id, t.category_id, t.name.trim().toLowerCase(),
  ]);
  const recurringSources = (month: string): Transaction[] => {
    const present = new Set<string>();
    const latest = new Map<string, Transaction>();
    for (const tx of txs) {
      if ((tx.invoice_payment || tx.balance_adjustment) || tx.type === "transferencia") continue;
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
    if (t.type === "transferencia" || (t.invoice_payment || t.balance_adjustment)) return null;
    return t.installment ? unpaidPortion(t, month) : t.status !== "pago" && t.date.slice(0, 7) === month ? amount(t) : null;
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
    expense -= creditsForMonth(creditEvents, m).reduce((total, item) => total + item.amount, 0);
    for (const source of recurringSources(m)) {
      if (source.type === "receita") pIncome += amount(source);
      else pExpense += amount(source);
    }
    for (const projected of localSubscriptionProjections(subscriptions, db.transactions, m, todayISO())) {
      pExpense += projected.subscription.value;
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
  for (const event of creditsForMonth(creditEvents, focus)) {
    byCat.set(event.category_id, (byCat.get(event.category_id) ?? 0) - event.amount);
  }
  // FIN-08: signed refunds remain in expense/net; the visual breakdown
  // displays only positive spending with percentages normalized to its own
  // positive denominator (no negative bars or percentages over 100%).
  const positiveCategories = [...byCat.entries()].filter(([, value]) => value > 0);
  const positiveExpense = round2(positiveCategories.reduce((sum, [, value]) => sum + value, 0));
  const categories: FlowCategory[] = positiveCategories
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => {
      const category = key ? db.categories.find((c) => c.id === key) : undefined;
      return {
        category_id: key,
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "#94A3B8",
        icon: category?.icon ?? "more-horizontal",
        total: round2(value),
        percent: positiveExpense ? Math.round((value / positiveExpense) * 1000) / 10 : 0,
      };
    });

  // Mirror of analytics._upcoming: the focus month's projection, item by item.
  const categoryOf = (id: string | null | undefined) => (id ? db.categories.find((c) => c.id === id) : undefined);
  const upcomingItem = (t: { name: string; type: string; account_id?: string | null; category_id?: string | null }, date: string, value: number, kind: UpcomingKind): UpcomingItem => ({
    date, name: t.name, value: round2(value), type: t.type === "receita" ? "receita" : "despesa", kind,
    account_id: t.account_id ?? null, category_id: t.category_id ?? null,
    category_name: categoryOf(t.category_id)?.name ?? null, category_color: categoryOf(t.category_id)?.color ?? null,
  });
  const [focusYear, focusMonth] = focus.split("-").map(Number);
  const upcoming: UpcomingItem[] = [];
  for (const tx of txs) {
    const value = projection(tx, focus);
    if (value === null) continue;
    const date = tx.date.slice(0, 7) === focus ? tx.date : clampDay(focusYear, focusMonth, Number(tx.date.slice(8, 10)));
    const kind: UpcomingKind = tx.installment ? "parcela" : tx.fixed ? "fixa" : tx.status === "pendente" ? "pendente" : "agendado";
    upcoming.push({ ...upcomingItem(tx, date, value, kind), transaction_id: tx.id });
  }
  for (const source of recurringSources(focus)) {
    upcoming.push(upcomingItem(source, clampDay(focusYear, focusMonth, Number(source.date.slice(8, 10))), amount(source), "fixa"));
  }
  for (const projected of localSubscriptionProjections(subscriptions, db.transactions, focus, todayISO())) {
    upcoming.push({ ...upcomingItem({ ...projected.subscription, type: "despesa" }, projected.date, projected.subscription.value, "assinatura"), subscription_id: projected.subscription.id });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

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
    upcoming,
  };
}

/** Account balance at the end of each real day of a month — mirrors backend cash_history. */
export function localBalanceHistory(month: string): BalanceHistory {
  const db = readDb();
  const [year, monthNumber] = month.split("-").map(Number);
  const last = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
  const today = todayISO();
  const cap = today < last ? today : last;
  const opening = db.accounts.reduce((sum, a) => sum + a.initial_balance, 0);
  const balanceOn = (day: string) => round2(db.transactions.reduce(
    (sum, tx) => sum + balanceEffects(tx, day).reduce((s, [, amount]) => s + amount, 0), opening));
  const first = `${month}-01`;
  if (cap < first) {
    const now = balanceOn(today);
    return { month, opening_balance: now, days: [], balance: now };
  }
  const before = new Date(year, monthNumber - 1, 0);
  const days: BalanceHistory["days"] = [];
  for (let n = 1; `${month}-${String(n).padStart(2, "0")}` <= cap; n += 1) {
    const date = `${month}-${String(n).padStart(2, "0")}`;
    days.push({ date, balance: balanceOn(date) });
  }
  return { month, opening_balance: balanceOn(toLocalISO(before)), days, balance: days.at(-1)?.balance ?? 0 };
}

/** Per-day entradas/saídas of a month — mirrors backend calendar_month(). */
export function localCalendar(month: string, categoryId?: string): CalendarMonth {
  const db = readDb();
  const [start, end] = monthBounds(month);
  const buckets = new Map<string, DayFlow>();
  // With a category, only its movements count; every bill still prevents a planned charge twice.
  const inCategory = (tx: { category_id?: string | null }) => !categoryId || tx.category_id === categoryId;
  const transactions = db.transactions.filter(inCategory);
  for (const tx of transactions) {
    if (tx.date < start || tx.date > end) continue;
    const day =
      buckets.get(tx.date) ??
      { date: tx.date, income: 0, expense: 0, projected_income: 0, projected_expense: 0, count: 0, active_count: 0 };
    day.count += 1;
    if (tx.type !== "transferencia" && !(tx.invoice_payment || tx.balance_adjustment) && !tx.invoice_refund) {
      const value = occurrenceAmount(tx);
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
  // A parcelado row is stored once; its later installments belong on their own
  // calendar days (mirror of analytics.calendar_month). No clickable count.
  for (const source of transactions) {
    if (!source.installment || source.date.slice(0, 7) === month
        || (source.type !== "receita" && source.type !== "despesa")
        || (source.invoice_payment || source.balance_adjustment) || source.invoice_refund) continue;
    const paid = source.status === "pago";
    const portion = paid ? monthPortion(source, month) : unpaidPortion(source, month);
    if (portion === null) continue;
    const key = clampDay(Number(month.slice(0, 4)), Number(month.slice(5, 7)), Number(source.date.slice(8, 10)));
    const day = buckets.get(key) ?? {
      date: key, income: 0, expense: 0, projected_income: 0,
      projected_expense: 0, count: 0, active_count: 0,
    };
    if (paid) {
      if (source.type === "receita") day.income = round2(day.income + portion);
      else day.expense = round2(day.expense + portion);
    } else if (source.type === "receita") {
      day.projected_income = round2(day.projected_income + portion);
    } else {
      day.projected_expense = round2(day.projected_expense + portion);
    }
    buckets.set(key, day);
  }
  // FIN-08/14: bank refund is a cash receipt but NOT ordinary income.
  // Both bank reimbursements and merchant credits reverse the purchase as
  // negative spend in the calendar on the event date.
  for (const credit of creditsForMonth(localCreditEvents(db), month).filter(inCategory)) {
    const day = buckets.get(credit.date) ?? {
      date: credit.date, income: 0, expense: 0, projected_income: 0,
      projected_expense: 0, count: 0, active_count: 0,
    };
    day.expense = round2(day.expense - credit.amount);
    if (credit.kind === "merchant_credit") day.count += 1;
    buckets.set(credit.date, day);
  }
  const subscriptions = subscriptionsInCategory(db.subscriptions, categoryId, db.categories.find(c => c.id === categoryId)?.name);
  const planned: PlannedCharge[] = [];
  for (const projected of localSubscriptionProjections(
    subscriptions, db.transactions, month, todayISO(),
  )) {
    const key = projected.date;
    const { id, name, value, account_id, card_id, category_id } = projected.subscription;
    planned.push({ date: key, subscription_id: id, name, value, account_id, card_id: card_id ?? null, category_id: category_id ?? null });
    const day = buckets.get(key) ?? {
      date: key, income: 0, expense: 0, projected_income: 0,
      projected_expense: 0, count: 0, active_count: 0,
    };
    day.projected_expense = round2(
      day.projected_expense + projected.subscription.value
    );
    // A planned subscription is not a recorded transaction.
    buckets.set(key, day);
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
    planned: planned.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
  };
}

// --- Cartões (mirror: backend/routers/cards.py + lib/cards.py) ---------------

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
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
  for (const [cycle, paid] of Object.entries(paidCycles)) {
    if (!paid.carried || !paid.carried_to) continue;
    if (!purchaseLines.has(paid.carried_to)) purchaseLines.set(paid.carried_to, new Map());
    purchaseLines.get(paid.carried_to)!.set(`carry:${cycle}`, paid.carried);
  }
  const settled = (cycle: string) => round2((paidCycles[cycle]?.amount ?? 0) + (paidCycles[cycle]?.carried ?? 0));
  const totals = new Map([...purchaseLines].map(([cycle, purchases]) => [
    cycle, round2([...purchases.values()].reduce((sum, value) => sum + value, 0)),
  ]));
  for (const [cycle, credits] of Object.entries(doc.invoice_adjustments ?? {})) {
    const creditTotal = credits.reduce((sum, item) => sum + item.value, 0);
    totals.set(cycle, round2((totals.get(cycle) ?? 0) - creditTotal));
  }
  let used = 0, future = 0;
  for (const [cycle, total] of totals) {
    const outstanding = round2(Math.max(0, total - settled(cycle)));
    used = round2(used + outstanding);
    if (cycle > closing) future = round2(future + outstanding);
  }
  const invoice = round2(Math.max(0, (totals.get(closing) ?? 0) - settled(closing)));
  // The invoice that already closed (the cycle before the open one) and what is still owed on it.
  const previousClosing = addDays(start, -1);
  const payable = round2(Math.max(0, (totals.get(previousClosing) ?? 0) - settled(previousClosing)));
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
    payable_invoice: payable,
    payable_cycle: payable > 0 ? previousClosing : null,
    payable_due: payable > 0 ? dueDate(previousClosing, doc.closing_day, doc.due_day) : null,
  };
}
export function localListCards(): CreditCard[] {
  const db = readDb();
  const institutions = new Map(db.institutions.map((i) => [i.id, i]));
  const defaults = effectiveDefaults(db.cards, () => "card");
  return db.cards.map((card) => {
    const built = buildCard(card, db.transactions, db.accounts);
    const institution = institutions.get(card.institution_id ?? "");
    return { ...built, institution: institution?.name ?? built.institution, color: institution?.color ?? built.color, is_default: defaults.has(card.id) };
  });
}

export function localCreateCard(raw: CardInput): CreditCard {
  const input = localResolveInstitution(raw, true);
  const db = readDb();
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
  const card: LocalCard = { ...input, id: newId(), created_at: new Date().toISOString() };
  db.cards = [...db.cards, card];
  if (input.is_default) db.cards = applyDefault(db.cards, card.id, () => true);
  writeDb(db);
  return localListCards().find((c) => c.id === card.id)!;
}

export function localUpdateCard(id: string, raw: CardInput): CreditCard {
  const input = localResolveInstitution(raw, true);
  const db = readDb();
  const existing = db.cards.find((c) => c.id === id);
  if (!existing) throw new Error("Cartão não encontrado.");
  if (existing.paid_cycles && Object.keys(existing.paid_cycles).length && (existing.closing_day !== input.closing_day || existing.due_day !== input.due_day)) {
    throw new Error("Não é possível mudar o ciclo de um cartão com pagamentos registrados.");
  }
  if (input.institution_id && !db.institutions.some(inst => inst.id === input.institution_id)) throw new Error("Instituição inválida.");
  const { is_default, ...fields } = input;
  const card: LocalCard = { ...existing, ...fields, ...(is_default === undefined ? {} : { is_default }) };
  db.cards = db.cards.map((c) => (c.id === id ? card : c));
  if (is_default) db.cards = applyDefault(db.cards, id, () => true);
  writeDb(db);
  return localListCards().find((c) => c.id === id)!;
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
  // Reminder only: invoices with money owed, due in the window or overdue (≤ 30 days).
  for (const card of db.cards) {
    if (!card.active) continue;
    const [start, current] = cycleBounds(today, card.closing_day);
    const [, previous] = cycleBounds(addDays(start, -1), card.closing_day);
    for (const closing of [previous, current]) {
      const due = dueDate(closing, card.closing_day, card.due_day);
      const daysLeft = dayDiff(due);
      if (daysLeft > windowDays || daysLeft < -30) continue;
      const state = invoiceForCycle(db, card, closing);
      const owed = state.outstanding ?? 0;
      const closed = closing < today;
      if (owed <= 0 && closed) continue;
      const overdue = daysLeft < 0;
      const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
      items.push({
        id: `card-${card.id}-${due}`,
        kind: "fatura",
        title: `Fatura ${card.name}${overdue ? " atrasada" : ""}`,
        description: overdue ? `Venceu em ${dm(due)}. Pague e confirme no FINNOS.`
          : closed ? `Vence em ${dm(due)}. Confirme no FINNOS quando pagar.`
          : `Fecha em ${dm(closing)} e vence em ${dm(due)}.`,
        date: due,
        value: Math.max(owed, 0),
        days_left: daysLeft,
        target_url: `/cartoes/${card.id}?cycle=${closing}`,
      });
    }
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
  for (const [source, paid] of Object.entries(card.paid_cycles ?? {})) {
    if (paid.carried_to !== closing || !paid.carried) continue;
    items.push({ id: `carry:${source}`, name: "Saldo da fatura anterior", date: source, value: paid.carried,
      category_name: null, category_color: null, installment_label: null, carry_from: source });
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
  const refunds = card.invoice_refunds?.[closing] ?? [];
  const adjustmentTotal = round2(adjustments.reduce((sum, item) => sum + item.value, 0));
  const total = round2(items.reduce((sum, item) => sum + item.value, 0) - adjustmentTotal);
  const paidAmount = round2(payment?.amount ?? 0);
  const carried = round2(payment?.carried ?? 0);
  return {
    card_id: card.id,
    card_name: card.name,
    cycle_start: start,
    cycle_end: closing,
    due_date: dueDate(closing, card.closing_day, card.due_day),
    total,
    paid: total > 0 && paidAmount === total,
    outstanding: round2(Math.max(0, total - paidAmount - carried)),
    paid_amount: paidAmount,
    paid_at: payment?.paid_at ?? null,
    carried_amount: carried,
    carried_to: carried ? payment?.carried_to ?? null : null,
    last_payment_id: payment?.last_payment_id ?? null,
    items,
    adjustments,
    adjustment_total: adjustmentTotal,
    refunds,
    refund_total: round2(refunds.reduce((total, item) => total + item.value, 0)),
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
  const account = db.accounts.find((a) => a.id === input.account_id);
  if (!account) throw new Error("Conta inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date + "T12:00:00")) || input.date > todayISO()) {
    throw new Error("A data do pagamento precisa ser válida e não pode estar no futuro.");
  }
  const closing = input.cycle ?? defaultLocalInvoiceCycle(db, card);
  if (closing !== configuredDayInMonth(closing, 0, card.closing_day)) throw new Error("Ciclo de fatura inválido.");
  const first = configuredDayInMonth(closing, -1, card.closing_day);
  const start = addDays(first, 1);
  const items = cycleItems(card, db.transactions, start, closing, db.categories);
  const state = invoiceForCycle(db, card, closing);
  const saved = card.paid_cycles?.[closing];
  const previous = saved?.amount ?? 0;
  const outstanding = state.outstanding ?? 0;
  const amount = round2(input.value ?? outstanding);
  if (outstanding <= 0) throw new Error("Esta fatura já foi quitada ou não possui compras.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) throw new Error("Pagamento deve ser positivo e não ultrapassar o saldo da fatura.");
  checkFunds(accountBalance(db, account.id), amount, account, Boolean(input.allow_overdraft));

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
  // Paying after the closing carries the rest; before it, it is an advance.
  const carried = closing < input.date && amount < outstanding ? round2(outstanding - amount) : 0;
  card.paid_cycles = {
    ...card.paid_cycles,
    [closing]: {
      ...saved,
      amount: round2(previous + amount), paid_at: input.date, items,
      payments: [...(saved?.payments ?? []), { id: debit.id, amount, carried, date: input.date }],
      last_payment_id: debit.id,
      ...(carried ? { carried, carried_to: configuredDayInMonth(closing, 1, card.closing_day) } : {}),
    },
  };
  db.cards = db.cards.map((c) => c.id === cardId ? card : c);
  writeDb(db);
  return localInvoice(cardId, closing);
}

/** Undo a transfer with an inverse transfer linked both ways (same rule as the server). */
export function localReverseTransfer(id: string, allowOverdraft = false): Transaction {
  const db = readDb();
  const original = db.transactions.find(t => t.id === id);
  if (!original) throw new Error("Transação não encontrada.");
  if (original.type !== "transferencia" || original.status !== "pago") throw new Error("Só uma transferência realizada pode ser desfeita.");
  if (original.reversal_of) throw new Error("Esta transferência já desfaz outra.");
  if (original.reversed_by) throw new Error("Esta transferência já foi desfeita.");
  const destination = db.accounts.find(a => a.id === original.to_account_id);
  if (!destination) throw new Error("A conta de destino não existe mais.");
  checkFunds(accountBalance(db, destination.id), original.value, destination, allowOverdraft);
  const inverse = buildTransaction(db, {
    name: `Desfaz: ${original.name}`, value: original.value, type: "transferencia", status: "pago", date: todayISO(),
    account_id: destination.id, card_id: null, to_account_id: original.account_id, category_id: null, fixed: false,
    recurrence: null, installment: false, total_installments: null, current_installment: null, adjusted_value: null,
    attachment: null, notes: `Desfaz a transferência de ${original.date}.`,
  });
  inverse.reversal_of = id;
  db.transactions = [...db.transactions.map(t => t.id === id ? { ...t, reversed_by: inverse.id, version: (t.version ?? 1) + 1 } : t), inverse];
  writeDb(db);
  return enrich(db, inverse);
}

/** Undo the last payment of a cycle with a linked reversal; the original stays. */
export function localUndoInvoicePayment(cardId: string, paymentId: string): Invoice {
  const db = readDb();
  const card = db.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  const entry = Object.entries(card.paid_cycles ?? {}).find(([, cycle]) => cycle.payments?.some(p => p.id === paymentId));
  if (!entry) throw new Error("Pagamento não encontrado.");
  const [closing, saved] = entry;
  if (saved.reconciled) throw new Error("Fatura já conferida: o pagamento não pode ser desfeito.");
  if (saved.last_payment_id !== paymentId) throw new Error("Só o último pagamento desta fatura pode ser desfeito.");
  const payments = [...(saved.payments ?? [])];
  const last = payments.pop()!;
  const next = last.carried ? saved.carried_to : undefined;
  if (next && card.paid_cycles?.[next]?.amount) throw new Error("A fatura seguinte já tem pagamento com o saldo levado; desfaça aquele primeiro.");
  const debit = db.transactions.find(t => t.id === paymentId);
  if (!debit) throw new Error("Lançamento do pagamento não encontrado.");
  const reversal = buildTransaction(db, {
    name: `Estorno do pagamento ${card.name}`, value: last.amount, type: "receita", status: "pago", date: todayISO(),
    account_id: debit.account_id, card_id: null, to_account_id: null, category_id: null, fixed: false, recurrence: null,
    installment: false, total_installments: null, current_installment: null, adjusted_value: null, attachment: null,
    notes: `Desfaz o pagamento da fatura fechada em ${closing}.`,
  });
  reversal.invoice_payment = true;
  reversal.invoice_reversal_of = paymentId;
  db.transactions = [...db.transactions, reversal];
  const updated: LocalPaidCycle = {
    ...saved, amount: round2(saved.amount - last.amount), payments,
    last_payment_id: payments.at(-1)?.id ?? null, paid_at: payments.at(-1)?.date ?? null,
  };
  const cycles = { ...card.paid_cycles, [closing]: updated };
  if (next) {
    delete updated.carried;
    delete updated.carried_to;
    const following = cycles[next];
    if (following?.items) cycles[next] = { ...following, items: following.items.filter(i => i.id !== `carry:${closing}`) };
  }
  card.paid_cycles = cycles;
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

/** Bank refund of a settled purchase: real cash movement, preserved invoice. */
export function localBankRefund(cardId: string, input: BankRefundInput, operationId: string): Invoice {
  const db = readDb();
  const card = db.cards.find(item => item.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  if (!operationId || operationId.length > 200) throw new Error("Identificador inválido.");
  if (!db.accounts.some(account => account.id === input.account_id)) throw new Error("Conta bancária inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > todayISO()) {
    throw new Error("Reembolso não pode ser realizado no futuro.");
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new Error("Descreva o motivo do reembolso.");
  const cents = Math.round(input.value * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(input.value * 100 - cents) > 1e-6) {
    throw new Error("Valor inválido.");
  }
  const key = `${cardId}:refund:${operationId}`;
  const fingerprint = JSON.stringify({ ...input, reason, cents });
  const previous = Object.values(card.invoice_refunds ?? {}).flat().find(item => item.id === key);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error("Identificador de reembolso reutilizado.");
    return invoiceForCycle(db, card, input.cycle);
  }
  const invoice = invoiceForCycle(db, card, input.cycle);
  if (!invoice.paid) throw new Error("Reembolso bancário exige fatura quitada.");
  const purchase = invoice.items.find(item => item.id === input.purchase_id);
  if (!purchase) throw new Error("Compra não encontrada nesta fatura.");
  const refunded = (invoice.refunds ?? []).filter(item => item.purchase_id === input.purchase_id)
    .reduce((total, item) => total + Math.round(item.value * 100), 0);
  const credited = (invoice.adjustments ?? []).filter(item => item.purchase_id === input.purchase_id)
    .reduce((total, item) => total + Math.round(item.value * 100), 0);
  if (refunded + credited + cents > Math.round(purchase.value * 100)) {
    throw new Error("Devoluções ultrapassam o valor da compra.");
  }
  const credit = buildTransaction(db, {
    name: `Reembolso ${card.name}`, type: "receita",
    value: cents / 100, status: "pago", date: input.date,
    account_id: input.account_id, card_id: null, to_account_id: null,
    category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null,
    adjusted_value: null, attachment: null, notes: input.reason,
  });
  credit.id = key;
  credit.invoice_refund = true;
  db.transactions.push(credit);
  card.invoice_refunds = {
    ...card.invoice_refunds,
    [input.cycle]: [
      ...(card.invoice_refunds?.[input.cycle] ?? []),
      { id: key, account_id: input.account_id, purchase_id: input.purchase_id,
        date: input.date, reason, value: cents / 100, fingerprint },
    ],
  };
  localAudit(db, "transactions", "created", null, credit);
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
    tx.type === "receita" && !tx.invoice_refund && tx.status === "pago" && tx.date.startsWith(month)
  ).reduce((sum, tx) => sum + tx.value, 0));
  return {
    items, monthly_total: monthly, yearly_total: yearly,
    income_percent: income ? round2(monthly / income * 100) : 0,
  };
}


// --- Conferência da conta com o extrato (etapa 3) — mirror of routers/reconciliations.py ---

const centsOf = (value: number) => Math.round(value * 100);

function balanceUntil(db: LocalDb, accountId: string, until: string): number {
  const account = db.accounts.find(a => a.id === accountId);
  let total = centsOf(account?.initial_balance ?? 0);
  for (const tx of db.transactions) {
    if (tx.date > until) continue;
    for (const [id, amount] of balanceEffects(tx, until)) if (id === accountId) total += centsOf(amount);
  }
  return total;
}

function reconSummary(doc: Reconciliation): Reconciliation {
  const counts: Record<string, number> = {};
  for (const line of doc.lines) counts[line.state] = (counts[line.state] ?? 0) + 1;
  const finnosOpen = doc.finnos.filter(f => f.state === "open").length;
  return { ...doc, counts, pending: (counts.review ?? 0) + (counts.open ?? 0) + finnosOpen };
}

function protectedTx(tx: Transaction | undefined): Transaction {
  if (!tx) throw new Error("Lançamento não encontrado; ele pode ter sido excluído.");
  if (tx.invoice_payment || tx.invoice_refund || tx.reversed_by || tx.reversal_of || tx.balance_adjustment)
    throw new Error("Este lançamento só muda pelo próprio fluxo (fatura, estorno ou ajuste).");
  return tx;
}

export function localCreateReconciliation(accountId: string, input: ReconciliationInput): Reconciliation {
  const db = readDb();
  const start = input.period_start, end = input.period_end;
  const span = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (span < 0 || span > 90) throw new Error("O extrato pode ter no máximo 90 dias.");
  if (end > todayISO()) throw new Error("O período não pode terminar no futuro.");
  if (!db.accounts.some(a => a.id === accountId)) throw new Error("Conta não encontrada.");
  const lines: MatchLine[] = input.lines.map((l, index) => {
    if (l.date < start || l.date > end) throw new Error(`Linha ${index + 1} fora do período do extrato.`);
    const base = { date: l.date, description: l.description.trim(), cents: centsOf(l.value), direction: l.direction, fitid: l.fitid ?? null };
    return { ...base, index, origin_key: originKey("local", accountId, base) };
  });
  const windowStart = addDays(start, -3), windowEnd = addDays(end, 3);
  const inWindow = db.transactions.filter(t => t.date >= windowStart && t.date <= windowEnd);
  const links: Record<string, string> = {};
  for (const [key, txId] of Object.entries(db.reconciliation_links ?? {})) if (key.startsWith(`${accountId}:`)) links[key.slice(accountId.length + 1)] = txId;
  const matched = matchLines(lines, inWindow, accountId, links);
  const doc: Reconciliation = {
    id: newId(), account_id: accountId, period_start: start, period_end: end, file_name: input.file_name, source: input.source,
    status: "pronta", bank_closing_cents: input.bank_closing_balance == null ? null : centsOf(input.bank_closing_balance),
    finnos_closing_cents: balanceUntil(db, accountId, end), counts: {}, pending: 0, created_at: new Date().toISOString(),
    lines: lines.map(line => {
      const r = matched.lines.get(line.index)!;
      const already = Boolean(r.tx_id) && [line.fitid, line.origin_key].some(k => k && links[k] === r.tx_id);
      const state = r.level === "strong" ? "matched" : r.level === "probable" || r.level === "value_diff" ? "review" : "open";
      return { ...line, level: already ? "already" : r.level, tx_id: r.tx_id, reasons: r.reasons, state };
    }),
    finnos: matched.onlyFinnos
      .filter(id => { const t = db.transactions.find(x => x.id === id); return Boolean(t && t.date >= start && t.date <= end); })
      .map(id => ({ tx_id: id, state: "open" as const, repeated_of: matched.repeated[id] ?? null })),
  };
  db.reconciliations = [...(db.reconciliations ?? []), doc];
  writeDb(db);
  return reconSummary(doc);
}

export function localListReconciliations(accountId: string): Reconciliation[] {
  return (readDb().reconciliations ?? []).filter(r => r.account_id === accountId).map(reconSummary).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function localGetReconciliation(id: string): Reconciliation {
  const db = readDb();
  const doc = (db.reconciliations ?? []).find(r => r.id === id);
  if (!doc) throw new Error("Conferência não encontrada.");
  const history = (db.reconciliation_events ?? []).filter(e => e.reconciliation_id === id).sort((a, b) => a.seq - b.seq);
  // Live: decisions and adjustments change the FINNOS side until it is concluded.
  const live = doc.status === "concluida" ? doc.finnos_closing_cents : balanceUntil(db, doc.account_id, doc.period_end);
  return { ...reconSummary(doc), finnos_closing_cents: live, history };
}

function saveRecon(db: LocalDb, doc: Reconciliation, event: Omit<ReconEvent, "id" | "seq" | "created_at" | "undone_by" | "undo_of"> & { before: unknown; after: unknown; effects: Record<string, unknown>; undo_of?: string | null }) {
  const seq = (db.reconciliation_events ?? []).filter(e => e.reconciliation_id === doc.id).length + 1;
  db.reconciliation_events = [...(db.reconciliation_events ?? []), {
    ...event, id: newId(), seq, created_at: new Date().toISOString(), undone_by: null, undo_of: event.undo_of ?? null, reconciliation_id: doc.id,
  }];
  db.reconciliations = (db.reconciliations ?? []).map(r => r.id === doc.id ? doc : r);
}

export function localResolveReconciliation(id: string, input: ReconResolveInput): Reconciliation {
  const db = readDb();
  const found = (db.reconciliations ?? []).find(r => r.id === id);
  if (!found) throw new Error("Conferência não encontrada.");
  if (found.status === "concluida") throw new Error("Conferência concluída; abra uma nova para mudar algo.");
  const doc: Reconciliation = JSON.parse(JSON.stringify(found));
  const effects: Record<string, unknown> = {};
  let target: string, before: unknown, after: unknown;
  if (input.line != null) {
    const line = doc.lines[input.line];
    if (!line) throw new Error("Linha não encontrada.");
    target = `line:${input.line}`; before = { ...line };
    const allowed: Record<string, string[]> = { review: ["confirm", "separate", "use_bank_value", "keep_value"], open: ["link", "ignore"] };
    if (!(allowed[line.state] ?? []).includes(input.action)) throw new Error("Esta linha já foi decidida; desfaça a decisão para mudar.");
    if (input.action === "confirm") line.state = "matched";
    else if (input.action === "separate") { doc.finnos.push({ tx_id: line.tx_id!, state: "open", repeated_of: null }); Object.assign(line, { state: "open", tx_id: null, level: "only_statement" }); }
    else if (input.action === "keep_value") Object.assign(line, { state: "matched", kept_difference: true });
    else if (input.action === "use_bank_value") {
      const tx = protectedTx(db.transactions.find(t => t.id === line.tx_id));
      effects.tx_updated = { id: tx.id, before_cents: centsOf(tx.value) };
      const updated = { ...tx, value: line.cents / 100, version: (tx.version ?? 1) + 1, updated_at: new Date().toISOString() };
      db.transactions = db.transactions.map(t => t.id === tx.id ? updated : t);
      localAudit(db, "transactions", "updated", tx, updated);
      line.state = "matched";
    } else if (input.action === "link") {
      if (!input.tx_id) throw new Error("Informe o lançamento a ligar.");
      if (doc.lines.some(l => l.tx_id === input.tx_id && l.state === "matched")) throw new Error("Este lançamento já está ligado a outra linha.");
      protectedTx(db.transactions.find(t => t.id === input.tx_id));
      Object.assign(line, { state: "matched", tx_id: input.tx_id, level: "linked" });
      doc.finnos = doc.finnos.filter(f => f.tx_id !== input.tx_id);
      effects.linked = input.tx_id;
    } else if (input.action === "ignore") line.state = "ignored";
    after = { ...line };
  } else {
    if (!input.tx_id) throw new Error("Informe a linha ou o lançamento.");
    const item = doc.finnos.find(f => f.tx_id === input.tx_id);
    if (!item || item.state !== "open") throw new Error("Este lançamento já foi decidido; desfaça a decisão para mudar.");
    target = `finnos:${input.tx_id}`; before = { ...item };
    if (input.action === "keep") item.state = "kept";
    else if (input.action === "keep_pending" || input.action === "delete") {
      const tx = protectedTx(db.transactions.find(t => t.id === input.tx_id));
      if (input.action === "keep_pending") {
        effects.tx_updated = { id: tx.id, before_status: tx.status };
        const updated = { ...tx, status: "pendente" as const, version: (tx.version ?? 1) + 1, updated_at: new Date().toISOString() };
        db.transactions = db.transactions.map(t => t.id === tx.id ? updated : t);
        localAudit(db, "transactions", "updated", tx, updated);
        item.state = "pending";
      } else {
        effects.tx_deleted = tx;
        db.transactions = db.transactions.filter(t => t.id !== tx.id);
        localAudit(db, "transactions", "deleted", tx, null);
        item.state = "deleted";
      }
    } else throw new Error("Ação inválida.");
    after = { ...item };
  }
  saveRecon(db, doc, { action: input.action, target, before, after, effects, note: input.note ?? "" });
  writeDb(db);
  return reconSummary(doc);
}

export function localUndoReconciliationEvent(id: string, eventId: string): Reconciliation {
  const db = readDb();
  const found = (db.reconciliations ?? []).find(r => r.id === id);
  if (!found) throw new Error("Conferência não encontrada.");
  if (found.status === "concluida") throw new Error("Conferência concluída; abra uma nova para mudar algo.");
  const events = (db.reconciliation_events ?? []).filter(e => e.reconciliation_id === id);
  const event = events.find(e => e.id === eventId);
  if (!event) throw new Error("Decisão não encontrada.");
  if (event.undone_by || event.undo_of) throw new Error("Esta decisão já foi desfeita.");
  const linked = event.effects.linked as string | undefined;
  if (events.some(e => e.seq > event.seq && !e.undone_by && !e.undo_of && (e.target === event.target || (linked && e.target === `finnos:${linked}`))))
    throw new Error("Uma decisão posterior depende desta; desfaça aquela primeiro.");
  const doc: Reconciliation = JSON.parse(JSON.stringify(found));
  const updatedFx = event.effects.tx_updated as { id: string; before_cents?: number; before_status?: Transaction["status"] } | undefined;
  if (updatedFx) {
    const tx = protectedTx(db.transactions.find(t => t.id === updatedFx.id));
    const restored = { ...tx, version: (tx.version ?? 1) + 1, updated_at: new Date().toISOString(),
      ...(updatedFx.before_cents != null ? { value: updatedFx.before_cents / 100 } : {}),
      ...(updatedFx.before_status ? { status: updatedFx.before_status } : {}) };
    db.transactions = db.transactions.map(t => t.id === tx.id ? restored : t);
    localAudit(db, "transactions", "updated", tx, restored);
  }
  const deleted = event.effects.tx_deleted as Transaction | undefined;
  if (deleted) {
    if (db.transactions.some(t => t.id === deleted.id)) throw new Error("O lançamento excluído já existe de novo.");
    db.transactions = [...db.transactions, deleted];
    localAudit(db, "transactions", "created", null, deleted);
  }
  const [kind, key] = [event.target.slice(0, event.target.indexOf(":")), event.target.slice(event.target.indexOf(":") + 1)];
  if (kind === "line") {
    const previous = event.before as Reconciliation["lines"][number];
    doc.lines[Number(key)] = previous;
    if (event.action === "separate") doc.finnos = doc.finnos.filter(f => f.tx_id !== previous.tx_id);
    if (event.action === "link" && linked) doc.finnos.push({ tx_id: linked, state: "open", repeated_of: null });
  } else doc.finnos = doc.finnos.map(f => f.tx_id === key ? event.before as Reconciliation["finnos"][number] : f);
  saveRecon(db, doc, { action: "undo", target: event.target, before: event.after, after: event.before, effects: {}, note: "", undo_of: eventId });
  const undoEvent = db.reconciliation_events!.at(-1)!;
  db.reconciliation_events = db.reconciliation_events!.map(e => e.id === eventId ? { ...e, undone_by: undoEvent.id } : e);
  writeDb(db);
  return reconSummary(doc);
}

export function localCompleteReconciliation(id: string): Reconciliation {
  const db = readDb();
  const found = (db.reconciliations ?? []).find(r => r.id === id);
  if (!found) throw new Error("Conferência não encontrada.");
  if (found.status === "concluida") return reconSummary(found);
  const summary = reconSummary(found);
  if (summary.pending) throw new Error(`Ainda há ${summary.pending} item(ns) para decidir.`);
  const finnosClosing = balanceUntil(db, found.account_id, found.period_end);
  if (found.bank_closing_cents != null && finnosClosing !== found.bank_closing_cents)
    throw new Error("Os saldos ainda não batem. Corrija o saldo ou revise as linhas.");
  const links = { ...(db.reconciliation_links ?? {}) };
  for (const line of found.lines) if (line.state === "matched" && line.tx_id)
    for (const key of [line.fitid, line.origin_key]) if (key) links[`${found.account_id}:${key}`] = line.tx_id;
  db.reconciliation_links = links;
  db.accounts = db.accounts.map(a => a.id === found.account_id && (!a.reconciled_until || a.reconciled_until < found.period_end) ? { ...a, reconciled_until: found.period_end } : a);
  const done: Reconciliation = { ...found, status: "concluida", finnos_closing_cents: finnosClosing };
  db.reconciliations = (db.reconciliations ?? []).map(r => r.id === id ? done : r);
  writeDb(db);
  return reconSummary(done);
}

export function localAdjustBalance(accountId: string, input: BalanceAdjustmentInput): BalanceAdjustment {
  const db = readDb();
  if (input.date > todayISO()) throw new Error("O ajuste não pode ter data futura.");
  if (input.reason.trim().length < 3) throw new Error("Explique o motivo do ajuste.");
  if (!db.accounts.some(a => a.id === accountId)) throw new Error("Conta não encontrada.");
  const before = balanceUntil(db, accountId, input.date);
  const target = centsOf(input.target_balance);
  const diff = target - before;
  if (diff === 0) throw new Error("O saldo já é este; nada a ajustar.");
  const tx = buildTransaction(db, {
    name: "Ajuste de saldo", value: Math.abs(diff) / 100, type: diff > 0 ? "receita" : "despesa", status: "pago", date: input.date,
    account_id: accountId, card_id: null, to_account_id: null, category_id: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, adjusted_value: null, attachment: null, notes: input.reason.trim(),
  });
  tx.balance_adjustment = true;
  db.transactions = [...db.transactions, tx];
  localAudit(db, "transactions", "created", null, tx);
  writeDb(db);
  return { id: tx.id, type: tx.type as "receita" | "despesa", value: tx.value, date: tx.date, previous_balance: before / 100, new_balance: target / 100, difference: diff / 100 };
}
