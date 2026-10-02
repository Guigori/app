// Hand-written mirrors of the Pydantic models in backend/models/ — nothing infers
// across the HTTP boundary, so keep this file in sync with the backend in the same edit.

export type TxType = "receita" | "despesa" | "transferencia";
export type TxStatus = "pago" | "pendente" | "agendado";
export type CategoryGroup = "necessidades" | "desejos" | "metas";
export type AccountType = "corrente" | "salario" | "digital" | "poupanca" | "carteira";
export type RuleStatus = "dentro" | "proximo" | "acima";

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  color: string;
  initial_balance: number;
  active: boolean;
  balance: number;
  total_income: number;
  total_expense: number;
  created_at: string;
}

export interface AccountInput {
  name: string;
  institution: string;
  type: AccountType;
  color: string;
  initial_balance: number;
  active: boolean;
}

export interface AccountDetail {
  account: Account;
  transactions: Transaction[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  group: CategoryGroup;
  monthly_budget: number;
  monthly_goal: number;
  created_at: string;
}

export interface CategoryInput {
  name: string;
  icon: string;
  color: string;
  group: CategoryGroup;
  monthly_budget: number;
  monthly_goal: number;
}

export interface Transaction {
  id: string;
  name: string;
  value: number;
  type: TxType;
  status: TxStatus;
  date: string;
  account_id: string;
  account_name: string;
  card_id: string | null;
  card_name: string | null;
  to_account_id: string | null;
  to_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  fixed: boolean;
  recurrence: string | null;
  installment: boolean;
  total_installments: number | null;
  current_installment: number | null;
  installment_value: number | null;
  adjusted_value: number | null;
  attachment: string | null;
  notes: string | null;
  created_at: string;
}

export interface TransactionInput {
  name: string;
  value: number;
  type: TxType;
  status: TxStatus;
  date: string;
  account_id: string;
  card_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  fixed: boolean;
  recurrence: string | null;
  installment: boolean;
  total_installments: number | null;
  current_installment: number | null;
  adjusted_value: number | null;
  attachment: string | null;
  notes: string | null;
}

export interface CategorySlice {
  category_id: string | null;
  name: string;
  color: string;
  icon: string;
  total: number;
  percent: number;
}

export interface RuleItem {
  key: CategoryGroup;
  label: string;
  spent: number;
  limit: number;
  percent: number;
  status: RuleStatus;
}

export interface Dashboard {
  month: string;
  total_balance: number;
  income: number;
  expense: number;
  month_balance: number;
  prev_income: number | null;
  prev_expense: number | null;
  invested: number;
  categories: CategorySlice[];
  rule: RuleItem[];
  recent: Transaction[];
}

// --- Analytics --------------------------------------------------------------

export type MetricKind = "income" | "expense" | "balance" | "invested";

export interface MonthTrend {
  month: string;
  label: string;
  income: number;
  expense: number;
  net: number;
}

export interface Trends {
  months: MonthTrend[];
  total_income: number;
  total_expense: number;
}

export type BudgetStatus = "sem_limite" | "dentro" | "proximo" | "acima";

export interface BudgetRow {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  group: CategoryGroup;
  budget: number;
  spent: number;
  remaining: number;
  percent: number;
  status: BudgetStatus;
}

export interface BudgetSummary {
  month: string;
  planned: number;
  spent: number;
  remaining: number;
  percent: number;
  income: number;
  unbudgeted_spent: number;
  rows: BudgetRow[];
}

// --- FINNOS IA (user's own provider key) ------------------------------------

export type AiProvider = "openai" | "anthropic" | "gemini";

export interface AiProviderInfo {
  provider: AiProvider;
  label: string;
  default_model: string;
  models: string[];
  console_url: string;
}

export interface AiKey {
  provider: AiProvider;
  masked: string;
  model: string;
}

export interface AiAnswer {
  answer: string;
  provider: AiProvider;
  model: string;
}

// --- Auth flow --------------------------------------------------------------

export interface SignupResult {
  email: string;
  verification_required: boolean;
  expires_in_minutes: number;
}

// --- Fluxo (mirror: backend/models/analytics.py FlowPoint/FlowCategory/FlowOut) ---

export type FlowTab = "receitas" | "despesas" | "caixa" | "projecao";
export type FlowPeriod = "3" | "6" | "12" | "custom";

export interface FlowPoint {
  month: string;
  label: string;
  year: string;
  income: number;
  expense: number;
  net: number;
  projected_income: number;
  projected_expense: number;
  projected_net: number;
  future: boolean;
}

export interface FlowCategory {
  category_id: string | null;
  name: string;
  color: string;
  icon: string;
  total: number;
  percent: number;
}

export interface Flow {
  month: string;
  from_month: string;
  to_month: string;
  income: number;
  expense: number;
  net: number;
  projected_income: number;
  projected_expense: number;
  projected_net: number;
  total_income: number;
  total_expense: number;
  total_net: number;
  series: FlowPoint[];
  categories: FlowCategory[];
}

export interface FlowParams {
  month?: string;
  months?: number;
  from_month?: string;
  to_month?: string;
  category_id?: string;
}

// --- Calendário (mirror: backend/models/analytics.py DayFlow/CalendarOut) ---

export interface DayFlow {
  date: string;
  income: number;
  expense: number;
  projected_income: number;
  projected_expense: number;
  count: number;
}

export interface CalendarMonth {
  month: string;
  days: DayFlow[];
  income: number;
  expense: number;
  net: number;
  projected_income: number;
  projected_expense: number;
  projected_balance: number;
}

// --- Cartões (mirror: backend/models/cards.py CardIn/CardOut) ---

export interface CardInput {
  name: string;
  institution: string;
  color: string;
  limit: number;
  closing_day: number;
  due_day: number;
  payment_account_id: string | null;
  active: boolean;
}

export interface CreditCard {
  id: string;
  name: string;
  institution: string;
  color: string;
  limit: number;
  closing_day: number;
  due_day: number;
  payment_account_id: string | null;
  payment_account_name: string | null;
  active: boolean;
  invoice_paid: boolean;
  current_invoice: number;
  future_installments: number;
  used: number;
  available: number;
  used_percent: number;
  cycle_start: string;
  next_closing: string;
  next_due: string;
  best_purchase_day: string;
  created_at: string;
}

// --- Notificações (mirror: backend/models/cards.py NotificationItem) ---

export type NotificationKind = "vencimento" | "atrasado" | "fatura";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  date: string;
  value: number;
  days_left: number;
}

export interface Notifications {
  items: NotificationItem[];
  count: number;
}

// --- Avisos / push (mirror: backend/models/notify.py NotifyPrefs) ---

export interface NotifyPrefsInput {
  push_enabled: boolean;
  email_enabled: boolean;
  hour: number;
  days_before: number;
}

export interface NotifyPrefs extends NotifyPrefsInput {
  push_devices: number;
  push_supported: boolean;
}

export interface PushPublicKey {
  public_key: string;
  supported: boolean;
}

// --- Assinaturas (mirror: backend/models/notify.py SubscriptionItem) ---

export interface SubscriptionItem {
  id: string;
  name: string;
  value: number;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  account_id: string;
  account_name: string;
  card_id: string | null;
  card_name: string | null;
  recurrence: string;
  next_charge: string;
  active: boolean;
}

export interface Subscriptions {
  items: SubscriptionItem[];
  monthly_total: number;
  yearly_total: number;
  income_percent: number;
}

// --- Fatura (mirror: backend/models/notify.py Invoice) ---

export interface InvoiceItem {
  id: string;
  name: string;
  date: string;
  value: number;
  category_name: string | null;
  category_color: string | null;
  installment_label: string | null;
}

export interface Invoice {
  card_id: string;
  card_name: string;
  cycle_start: string;
  cycle_end: string;
  due_date: string;
  total: number;
  paid: boolean;
  paid_amount: number;
  paid_at: string | null;
  items: InvoiceItem[];
}

export interface PayInvoiceInput {
  account_id: string;
  date: string;
  value: number | null;
}
