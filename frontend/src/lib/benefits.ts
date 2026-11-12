import { formatBRL } from "@/lib/format";
import type { BenefitWallet, BenefitWalletInput, Transaction } from "@/types/finnos";

/** Benefit cards (etapa 5). Same rules as finnos/lib/benefits.py: up to 8
 * benefits per card, unique names, one default; unused balance never expires;
 * one recharge per benefit and month (id derived from card, benefit and month);
 * a benefit does not go negative unless configured. */
export const MAX_WALLETS = 8;

export type StoredWallet = Omit<BenefitWallet, "balance" | "daily_allowance" | "next_recharge" | "runs_out_on"> & { start: string };

const key = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean).join(" ");
const toCents = (value: number) => Math.round(value * 100);

export class BenefitFundsError extends Error {
  code = "saldo_beneficio_insuficiente" as const;
  available: number;
  amount: number;
  wallet_id: string;
  constructor(message: string, available: number, amount: number, walletId: string) {
    super(message);
    this.name = "BenefitFundsError";
    this.available = available;
    this.amount = amount;
    this.wallet_id = walletId;
  }
}

/** The benefit funds problem behind an error from the API or the local engine. */
export function benefitFundsIssue(error: unknown): { message: string; available: number; amount: number; wallet_id: string } | null {
  if (error instanceof BenefitFundsError) return error;
  const detail = (error as { body?: { detail?: { code?: string } } } | null)?.body?.detail;
  if (detail && typeof detail === "object" && detail.code === "saldo_beneficio_insuficiente") {
    return detail as unknown as { message: string; available: number; amount: number; wallet_id: string };
  }
  return null;
}

export function normalizeWallets(wallets: BenefitWalletInput[], existing: StoredWallet[] = [], today: string, inUse = new Set<string>(), newId = () => Math.random().toString(36).slice(2, 14)): StoredWallet[] {
  if (wallets.length > MAX_WALLETS) throw new Error(`Um cartão de benefício tem no máximo ${MAX_WALLETS} benefícios.`);
  const previous = new Map(existing.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const out: StoredWallet[] = wallets.map((raw) => {
    const name = raw.name.split(/\s+/).filter(Boolean).join(" ");
    if (name.length < 1 || name.length > 40) throw new Error("Cada benefício precisa de um nome com até 40 letras.");
    if (seen.has(key(name))) throw new Error(`Já existe um benefício chamado ${name}.`);
    seen.add(key(name));
    if (!(raw.day >= 1 && raw.day <= 31)) throw new Error(`O dia da recarga de ${name} precisa ser de 1 a 31.`);
    if (raw.monthly_amount < 0) throw new Error(`O valor mensal de ${name} não pode ser negativo.`);
    const id = raw.id || newId();
    const kept = previous.get(id);
    return {
      id, name, monthly_amount: Math.round(raw.monthly_amount * 100) / 100, day: Math.trunc(raw.day),
      allow_negative: Boolean(raw.allow_negative), is_default: Boolean(raw.is_default),
      start: kept?.start ?? today, initial_balance: Math.round((raw.initial_balance ?? 0) * 100) / 100,
    };
  });
  const kept = new Set(out.map((w) => w.id));
  if ([...previous.keys()].some((id) => !kept.has(id) && inUse.has(id))) {
    throw new Error("Benefício com histórico não pode ser removido; deixe o valor mensal em zero.");
  }
  const defaults = out.filter((w) => w.is_default);
  if (out.length && defaults.length !== 1) out.forEach((w, i) => { w.is_default = defaults.length ? w.id === defaults[0].id : i === 0; });
  return out;
}

export function defaultWalletId(account: { wallets?: { id: string; is_default: boolean }[] }): string | null {
  const wallets = account.wallets ?? [];
  return wallets.find((w) => w.is_default)?.id ?? wallets[0]?.id ?? null;
}

type Effects = (tx: Transaction, today: string) => [string, number][];

/** Per-benefit balance; legacy movements without a benefit fall on the default. */
export function walletBalances(account: { id: string; wallets?: StoredWallet[] }, txs: Transaction[], today: string, effects: Effects, excludeId?: string): Map<string, number> {
  const balances = new Map((account.wallets ?? []).map((w) => [w.id, toCents(w.initial_balance ?? 0)]));
  if (!balances.size) return balances;
  const fallback = defaultWalletId(account)!;
  const pick = (id: string | null | undefined) => (id && balances.has(id) ? id : fallback);
  for (const tx of txs) {
    if (tx.id === excludeId) continue;
    if (tx.type === "transferencia" && tx.account_id === account.id && tx.to_account_id === account.id) {
      if (tx.status !== "pago" || tx.date > today) continue;
      balances.set(pick(tx.wallet_id), balances.get(pick(tx.wallet_id))! - toCents(tx.value));
      balances.set(pick(tx.to_wallet_id), balances.get(pick(tx.to_wallet_id))! + toCents(tx.value));
      continue;
    }
    for (const [id, amount] of effects(tx, today)) {
      if (id !== account.id) continue;
      const incoming = tx.type === "transferencia" && tx.to_account_id === account.id;
      const wallet = pick(incoming ? tx.to_wallet_id : tx.wallet_id);
      balances.set(wallet, balances.get(wallet)! + toCents(amount));
    }
  }
  return balances;
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function rechargeDate(wallet: { day: number }, year: number, month: number): string {
  return iso(year, month, Math.min(wallet.day, lastDay(year, month)));
}

/** Recharges of this and last month that are due by ``today``. */
export function dueRecharges(account: { wallets?: StoredWallet[] }, today: string): { wallet: StoredWallet; competence: string; date: string }[] {
  const [y, m] = today.split("-").map(Number);
  const months: [number, number][] = [m === 1 ? [y - 1, 12] : [y, m - 1], [y, m]];
  const found = [];
  for (const wallet of account.wallets ?? []) {
    if (!(wallet.monthly_amount > 0)) continue;
    for (const [year, month] of months) {
      const date = rechargeDate(wallet, year, month);
      if (date <= today && date >= (wallet.start ?? today).slice(0, 10)) found.push({ wallet, competence: `${year}-${String(month).padStart(2, "0")}`, date });
    }
  }
  return found;
}

export const rechargeId = (accountId: string, walletId: string, competence: string) => `recharge:${accountId}:${walletId}:${competence}`;

export function pace(wallet: StoredWallet, balanceCents: number, txs: Transaction[], accountId: string, fallback: string | null, today: string) {
  const [y, m] = today.split("-").map(Number);
  let next = rechargeDate(wallet, y, m);
  if (next <= today) next = m === 12 ? rechargeDate(wallet, y + 1, 1) : rechargeDate(wallet, y, m + 1);
  const dayMs = 86400000;
  const t = Date.parse(`${today}T00:00:00Z`);
  const daysLeft = Math.max(1, Math.round((Date.parse(`${next}T00:00:00Z`) - t) / dayMs));
  const since = new Date(t - 30 * dayMs).toISOString().slice(0, 10);
  const spent = txs.filter((tx) => tx.type === "despesa" && tx.status === "pago" && !tx.card_id && tx.account_id === accountId
    && (tx.wallet_id || fallback) === wallet.id && tx.date >= since && tx.date <= today)
    .reduce((sum, tx) => sum + toCents(tx.value), 0);
  const perDay = spent / 30;
  let runsOut: string | null = null;
  if (perDay > 0 && balanceCents > 0) {
    const day = new Date(t + Math.floor(balanceCents / perDay) * dayMs).toISOString().slice(0, 10);
    if (day < next) runsOut = day;
  }
  return { next_recharge: next, daily_allowance: Math.max(0, balanceCents) / 100 / daysLeft, runs_out_on: runsOut };
}

export function checkWalletFunds(balanceCents: number, amount: number, wallet: { id: string; name: string; allow_negative: boolean }): void {
  if (wallet.allow_negative || balanceCents - toCents(amount) >= 0) return;
  throw new BenefitFundsError(`${wallet.name} tem ${formatBRL(Math.max(balanceCents, 0) / 100)}. Divida o valor com outro benefício ou com uma conta.`,
    Math.max(balanceCents, 0) / 100, amount, wallet.id);
}
