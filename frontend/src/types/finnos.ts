// Hand-written mirrors of the Pydantic models in backend/models/ — nothing infers
// across the HTTP boundary, so keep this file in sync with the backend in the same edit.

export type TxType = "receita" | "despesa" | "transferencia";
export type TxStatus = "pago" | "pendente" | "agendado";
export type CategoryGroup = "necessidades" | "desejos" | "metas";
export type AccountType = "corrente" | "salario" | "digital" | "poupanca" | "carteira" | "beneficio";
export type RuleStatus = "dentro" | "proximo" | "acima";

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
  session_mode?: "account" | "local" | "demo";
  auth_provider?: string;
  auth_providers?: string[];
}

export type InstitutionKind = "banco" | "beneficio" | "outro";

export interface Institution {
  id: string;
  name: string;
  /** Decided by the institution (catalog color, or a stable one for custom names). */
  color: string;
  kind?: InstitutionKind;
  catalog_id?: string | null;
  created_at: string;
}

/** A catalog entry, or a typed name. Any color sent is ignored by the server. */
export interface InstitutionInput {
  name?: string;
  catalog_id?: string | null;
  color?: string;
}

export interface InstitutionCatalogItem {
  id: string;
  name: string;
  color: string;
  kind: InstitutionKind;
}

export interface LegacyLinkResult {
  linked_accounts: number;
  linked_cards: number;
  created_institutions: number;
}

export interface Account {
  version?: number;
  id: string;
  name: string;
  institution: string;
  institution_id?: string | null;
  type: AccountType;
  color: string;
  initial_balance: number;
  active: boolean;
  /** Preselected for its kind: bank account, benefit or cash. */
  is_default?: boolean;
  /** Cheque especial: how far below zero a confirmed payment/transfer may go. */
  overdraft_limit?: number | null;
  /** Last statement date that closed with the FINNOS balance (conferência). */
  reconciled_until?: string | null;
  balance: number;
  total_income: number;
  total_expense: number;
  created_at: string;
}

export interface AccountInput {
  name: string;
  institution: string;
  institution_id?: string | null;
  type: AccountType;
  /** Ignored when the account has an institution: the color comes from it. */
  color: string;
  initial_balance: number;
  active: boolean;
  /** Omit to keep the current flag. */
  is_default?: boolean;
  /** Omit to keep the current limit; 0 removes it. */
  overdraft_limit?: number | null;
}

export interface AccountDetail {
  account: Account;
  transactions: Transaction[];
}

export interface HistoricalInvoiceReview {
  status: "review_required" | "no_issues_detected_not_migration_verified";
  counts: Record<string, number>;
  examples: Array<{
    reason: string;
    card_id: string;
    cycle: string | null;
    item_id?: string;
    recorded_paid_cents?: number;
    matched_bank_payment_cents?: number;
  }>;
  sample_limit: number;
  auto_fixed: false;
  legacy_source_compared: false;
}

export interface FiintMaturity {
  version: "fiint-v1";
  status: "read_only";
  finance_revision: number;
  score: number;
  score_max: 100;
  score_label: string;
  maturity_month: number;
  months_observed: number;
  history_span_months: number;
  stage: string;
  history_start: string | null;
  criteria: Array<{ id: string; label: string; completed: boolean; points: number }>;
  monthly_history: Array<{
    month: string; income: number; expense: number; net: number;
    entries: number; has_confirmed_data: boolean;
  }>;
  data_quality: {
    active_accounts: number; categories: number;
    months_with_settled_records: number; active_subscriptions: number;
    has_open_budget: boolean;
  };
  is_financial_health_score: false;
  writes_data: false;
  disclaimer: string;
}

export interface FinanceIntegrity {
  storage: "firestore";
  integrity_ok: boolean;
  issues: Record<string, number>;
  has_financial_records: boolean;
  total_account_balance: number | null;
  legacy_reconciliation: "not_verified";
  historical_invoices: HistoricalInvoiceReview;
}

export interface FinanceHistoryEvent {
  id: string;
  entity: string;
  entity_id: string;
  action: "created" | "updated" | "deleted";
  summary: string;
  created_at: string;
  before: Record<string, string | number> | null;
  after: Record<string, string | number> | null;
}
export interface FinanceHistoryPage {
  items: FinanceHistoryEvent[];
  next_cursor: string | null;
}

export interface Category {
  version?: number;
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
  /** Came from the Apple Pay queue: reviewed by the person, or registered automatically. */
  capture?: "apple_pay" | "apple_pay_auto" | null;
  /** Registered automatically although far above the merchant's usual value. */
  capture_unusual?: boolean;
  recurrence_id?: string | null;
  invoice_payment?: boolean;
  /** Auditable balance correction (conferência): out of spending and income. */
  balance_adjustment?: boolean;
  /** Set on the reversal that undid an invoice payment. */
  invoice_reversal_of?: string | null;
  /** Transfer undo: the inverse transfer points to the original and back. */
  reversal_of?: string | null;
  reversed_by?: string | null;
  invoice_refund?: boolean;
  version?: number;
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
  origin?: string | null;
  notify_enabled?: boolean;
  created_at: string;
}

export interface TransactionPage {
  month: string;
  items: Transaction[];
  next_cursor: string | null;
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
  origin?: string | null;
  notify_enabled?: boolean;
  /** The person confirmed using the cheque especial for this transfer. */
  allow_overdraft?: boolean;
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

export interface BudgetSuggestion {
  expected_income: number;
  method: "media_recente";
  writes_data: false;
  categories: { category_id: string; name: string; group: CategoryGroup; average: number; suggested: number; months_observed: number }[];
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
  pace_day?: number;
  pace_days_in_month?: number;
  pace_ideal?: number;
  pace_daily_allowance?: number;
  pace_projected_close?: number;
  pace_difference?: number;
  pace_cumulative?: number[];
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

// --- Budget V2 ---------------------------------------------------------------

export type BudgetMode = "503020" | "personalizado";
export type BudgetPeriod = "semanal" | "quinzenal" | "mensal" | "anual";
export type BudgetPriority = "essencial" | "flexivel" | "meta";
export type BudgetCycleStatus = "programado" | "ativo" | "fechado";

export interface BudgetAllocationV2 {
  category_id: string; planned: number; priority: BudgetPriority; rollover: boolean;
  name?: string | null; icon?: string | null; color?: string | null;
}
export interface BudgetCycle {
  id: string; mode: BudgetMode; period: BudgetPeriod; start_date: string; end_date: string;
  expected_income: number; allocations: BudgetAllocationV2[]; extraordinary: boolean;
  notes?: string | null; status: BudgetCycleStatus; created_at: string; closed_at?: string | null;
}
export interface BudgetAllocationProgress extends BudgetAllocationV2 {
  spent: number; committed: number; available: number; projected_close: number; percent: number;
}
export interface BudgetCycleProgress {
  cycle_id: string; start_date: string; end_date: string; planned: number; spent: number;
  committed: number; available: number; projected_close: number; expected_income: number;
  received_income: number; committed_income: number; safe_to_spend: number;
  elapsed_percent: number; used_percent: number; pace: "sem_plano" | "abaixo" | "no_ritmo" | "acima";
  allocations: BudgetAllocationProgress[];
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
  /** What is still expected in the focus month; together it makes up the projection. Older servers omit it. */
  upcoming?: UpcomingItem[];
}

export type UpcomingKind = "agendado" | "pendente" | "parcela" | "fixa" | "assinatura";

export interface UpcomingItem {
  date: string;
  name: string;
  value: number;
  type: "receita" | "despesa";
  kind: UpcomingKind;
  transaction_id?: string | null;
  subscription_id?: string | null;
  account_id?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
}

export interface FlowParams {
  month?: string;
  months?: number;
  from_month?: string;
  to_month?: string;
  category_id?: string;
  account_id?: string;
}

// --- Calendário (mirror: backend/models/analytics.py DayFlow/CalendarOut) ---

export interface DayFlow {
  date: string;
  income: number;
  expense: number;
  projected_income: number;
  projected_expense: number;
  count: number;
  active_count: number;
}

/** A registered subscription expected on a day: a plan, not a transaction. */
export interface PlannedCharge {
  date: string;
  subscription_id: string;
  name: string;
  value: number;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
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
  /** Older servers omit it. */
  planned?: PlannedCharge[];
}

/** Money in the accounts at the end of each real day of a month (mirror: BalanceHistoryOut).
 *  Same rule as "Saldo total": card purchases count when the invoice is paid. */
export interface BalanceHistory {
  month: string;
  opening_balance: number;
  /** Only days that already happened: up to today, or the whole of a past month. */
  days: { date: string; balance: number }[];
  /** Balance on the last real day; for this month it equals Saldo total. */
  balance: number;
}

// --- Cartões (mirror: backend/models/cards.py CardIn/CardOut) ---

export interface CardInput {
  name: string;
  institution: string;
  institution_id?: string | null;
  color: string;
  limit: number;
  closing_day: number;
  due_day: number;
  payment_account_id: string | null;
  active: boolean;
  /** Omit to keep the current flag. */
  is_default?: boolean;
}

export interface CreditCard {
  version?: number;
  id: string;
  name: string;
  institution: string;
  institution_id?: string | null;
  color: string;
  limit: number;
  closing_day: number;
  due_day: number;
  payment_account_id: string | null;
  payment_account_name: string | null;
  active: boolean;
  /** The preselected credit card. */
  is_default?: boolean;
  invoice_paid: boolean;
  current_invoice: number;
  payable_invoice?: number;
  payable_cycle?: string | null;
  payable_due?: string | null;
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

export type NotificationKind = "vencimento" | "atrasado" | "fatura" | "captura";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  date: string;
  value: number;
  days_left: number;
  target_url: string;
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
  transaction_reminders: boolean;
  invoice_reminders: boolean;
  radar_alerts: boolean;
  activity_reminders: boolean;
  weekly_summary: boolean;
  system_notices: boolean;
}

export interface NotifyPrefs extends NotifyPrefsInput {
  push_devices: number;
  push_supported: boolean;
}

export interface PushPublicKey {
  public_key: string;
  supported: boolean;
}

// A subscription is a standalone plan, not a fixed expense transaction.
export interface SubscriptionInput {
  name: string;
  value: number;
  recurrence: "mensal" | "anual";
  next_charge: string;
  account_id: string;
  category_id: string | null;
  card_id: string | null;
  active: boolean;
  notes: string | null;
}

// --- Assinaturas (mirror: backend/models/notify.py SubscriptionItem) ---

export interface SubscriptionItem {
  version?: number;
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
  recurrence: "mensal" | "anual";
  next_charge: string;
  active: boolean;
  notes?: string | null;
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
  /** Set on the "Saldo da fatura anterior" line: the cycle the balance came from. */
  carry_from?: string | null;
}

export interface InvoiceAdjustment {
  id: string;
  purchase_id: string;
  date: string;
  reason: string;
  value: number;
}

export interface BankRefundInput {
  cycle: string;
  purchase_id: string;
  account_id: string;
  date: string;
  value: number;
  reason: string;
}
export interface BankRefund {
  id: string;
  purchase_id: string;
  account_id: string;
  date: string;
  value: number;
  reason: string;
}

export interface CreditInvoiceInput {
  cycle: string;
  purchase_id: string;
  value: number;
  reason: string;
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
  outstanding?: number;
  paid_at: string | null;
  /** Partial payment of a closed invoice: the rest moved to `carried_to`. */
  carried_amount?: number;
  carried_to?: string | null;
  last_payment_id?: string | null;
  /** Conferred against the bank's invoice; the minimum comes from it. */
  reconciled?: boolean;
  minimum_payment?: number | null;
  items: InvoiceItem[];
  adjustments?: InvoiceAdjustment[];
  adjustment_total?: number;
  refunds?: BankRefund[];
  refund_total?: number;
}

export interface PayInvoiceInput {
  cycle?: string;
  account_id: string;
  date: string;
  value: number | null;
  /** The person confirmed using the account's cheque especial. */
  allow_overdraft?: boolean;
}


// --- Radar (mirror: backend/models/radar.py) ---------------------------------

export type RadarSignalType = "risk" | "deviation" | "information" | "opportunity";
export type RadarSignalSeverity = "normal" | "medium" | "high" | "critical";
export type RadarSignalState = "new" | "active" | "viewed" | "resolved" | "expired" | "dismissed";

export interface RadarSignal {
  id: string;
  type: RadarSignalType;
  severity: RadarSignalSeverity;
  state: RadarSignalState;
  title: string;
  description: string;
  explanation: string;
  metric: string | null;
  radar_position: number;
  score: number;
  related_entity_type: string | null;
  related_entity_id: string | null;
  expires_at: string | null;
  evidence: { label: string; value: string }[];
  detected_at: string | null;
  /** Reais above the limit or the usual pattern; older servers omit it. */
  impact?: number | null;
}

export interface Radar {
  items: RadarSignal[];
  count: number;
}

// --- Compras pendentes do Apple Pay (mirror: finnos/routers/pending_captures.py) ---

/** A purchase the Shortcut left on the server. Nothing counts in the balance until it is registered. */
export interface PendingCapture {
  id: string;
  name: string;
  value: number;
  date: string;
  created_at?: string | null;
  /** A fake purchase that shows the Shortcut works: it can only be deleted. */
  is_test: boolean;
  waiting_days: number;
  /** Waiting for days: shown as "pendente há N dias" so it is not forgotten. */
  stale: boolean;
  /** Where the money comes out, checked against today's cards and accounts. */
  source_kind: "cartao" | "conta" | "desconhecido";
  source_registered: boolean;
  source_id: string | null;
  source_name: string | null;
  /** The card name exactly as Apple Pay sent it ("" when it sent none). */
  source_sent: string;
  /** For a card, the account that pays its invoice. */
  pays_from: string | null;
  /** One plain-Portuguese line for the screen. */
  origin: string;
  /** Always "debito": the person switches to crédito when that is how they paid. */
  suggested_method: PaymentMethod;
  /** Débito: learned account for this Apple Pay card name, else the one with that name or that pays that card. */
  suggested_account_id: string | null;
  /** Crédito: learned card, else the card with that name. */
  suggested_card_id: string | null;
  /** Learned for this merchant, else the category of the last lançamento with the same name. */
  suggested_category_id: string | null;
  /** Apple Pay's name is both an account and a card ("Nubank"): débito or crédito is picked every time. */
  ambiguous?: boolean;
  learned_wallet: boolean;
  learned_category: boolean;
}

export type PaymentMethod = "debito" | "credito";

/** A purchase FINNOS registered on its own (débito, learned combination), to confirm or undo. */
export interface AutoRegisteredCapture {
  id: string;
  transaction_id: string;
  name: string;
  value: number;
  date: string | null;
  account_name: string | null;
  category_id: string | null;
  /** Registered although far above the merchant's usual (the hold was off). */
  unusual?: boolean;
}

export interface PendingCaptures {
  items: PendingCapture[];
  count: number;
  /** Registered on their own in the last days. */
  auto?: AutoRegisteredCapture[];
}

/** What the person fixed before registering; every field is optional. */
export interface PendingCaptureConfirm {
  method?: PaymentMethod;
  account_id?: string | null;
  card_id?: string | null;
  category_id?: string | null;
  name?: string;
  value?: number;
  date?: string;
  installments?: number;
}

export interface PendingSettings {
  /** Register automatically a débito combination confirmed several times in a row. */
  auto_register: boolean;
  /** A value far above the merchant's usual waits for review even with auto on (default on). */
  hold_unusual?: boolean;
}

export interface ConfirmAllResult {
  ok: boolean;
  registered: number;
  /** Still waiting: the wallet is unknown, or it is a test purchase. */
  skipped: number;
  failed: { id: string; name: string; detail: string }[];
}

/** Conferência da conta com o extrato (etapa 3). Money in cents. */
export type ReconLineState = "matched" | "review" | "open" | "ignored";
export interface ReconLine {
  index: number; date: string; description: string; cents: number; direction: "in" | "out";
  fitid?: string | null; origin_key: string;
  level: "strong" | "probable" | "value_diff" | "only_statement" | "already" | "linked";
  tx_id: string | null; reasons: string[]; state: ReconLineState; kept_difference?: boolean;
  /** Card invoice lines read by the FDI. */
  operation?: string | null; installment?: { current: number; total: number } | null;
  confidence?: "high" | "medium" | "low"; evidence?: string | null;
}
export interface ReconFinnosItem { tx_id: string; state: "open" | "kept" | "pending" | "deleted"; repeated_of: string | null; name?: string; cents?: number }
export interface ReconEvent {
  id: string; seq: number; action: string; target: string; note?: string; created_at: string;
  undone_by: string | null; undo_of: string | null;
}
export interface Reconciliation {
  /** "card": conferência of one invoice (cycle = closing date). */
  scope?: "account" | "card"; card_id?: string | null; cycle?: string | null;
  invoice_fields?: { due_date?: string; total_cents?: number; minimum_payment_cents?: number; card_last_digits?: string };
  invoice_checks?: { name: string; passed: boolean | null; detail: string }[]; warnings?: string[]; difference_note?: string | null;
  id: string; account_id: string | null; period_start: string; period_end: string; file_name: string;
  source: "ofx" | "csv" | "pdf" | "ocr"; status: "pronta" | "concluida";
  bank_closing_cents: number | null; finnos_closing_cents: number;
  lines: ReconLine[]; finnos: ReconFinnosItem[]; counts: Record<string, number>; pending: number;
  history?: ReconEvent[]; created_at: string;
}
export interface ReconciliationInput {
  period_start: string; period_end: string; file_name: string; file_hash: string; source: Reconciliation["source"];
  bank_closing_balance: number | null;
  lines: { date: string; description: string; value: number; direction: "in" | "out"; fitid?: string | null }[];
}
export interface CardReconciliationInput {
  cycle: string; file_name: string; file_hash: string; source: Reconciliation["source"];
  pages?: { page: number; text: string }[];
  lines?: ReconciliationInput["lines"];
}
export interface ReconResolveInput { line?: number; tx_id?: string; action: string; note?: string }
export interface BalanceAdjustmentInput { target_balance: number; reason: string; date: string; reconciliation_id?: string | null }
export interface BalanceAdjustment { id: string; type: "receita" | "despesa"; value: number; date: string; previous_balance: number; new_balance: number; difference: number }

