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
