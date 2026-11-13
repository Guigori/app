import type { Account, CreditCard } from "@/types/finnos";
import { walletGroups, type WalletGroup } from "@/lib/institutionGroups";
import type { Institution } from "@/types/finnos";

/** Nova Carteira (etapa 6). Indicators are kept apart on purpose (v1.1): money
 * available, benefits available, open invoices and free limit never add up to
 * one number, because they are different kinds of money. */
export interface WalletIndicators {
  /** Bank accounts + physical cash, active only. */
  cashCents: number;
  bankCents: number;
  physicalCents: number;
  benefitsCents: number;
  /** Closed-not-paid + the current open cycle of every active card. */
  invoicesCents: number;
  freeLimitCents: number;
  limitCents: number;
}

export interface UpcomingInvoice {
  cardId: string;
  cardName: string;
  color: string;
  amountCents: number;
  due: string;
  /** closed = already closed, waiting payment; open = still taking purchases. */
  state: "overdue" | "closed" | "open";
}

export interface OpenReconciliation {
  id: string;
  scope: "account" | "card";
  account_id: string | null;
  card_id: string | null;
  cycle?: string | null;
  period_end: string | null;
  difference: number | null;
  pending: number;
}

export interface WalletWarning {
  key: string;
  tone: "danger" | "attention";
  title: string;
  detail: string;
  /** Route that resolves it. */
  to: string;
}

const c = (value: number | null | undefined) => Math.round((value ?? 0) * 100);

export function walletIndicators(accounts: Account[], cards: CreditCard[]): WalletIndicators {
  const active = accounts.filter((a) => a.active);
  const bankCents = active.filter((a) => a.type !== "beneficio" && a.type !== "carteira").reduce((s, a) => s + c(a.balance), 0);
  const physicalCents = active.filter((a) => a.type === "carteira").reduce((s, a) => s + c(a.balance), 0);
  const benefitsCents = active.filter((a) => a.type === "beneficio").reduce((s, a) => s + c(a.balance), 0);
  const live = cards.filter((card) => card.active);
  return {
    cashCents: bankCents + physicalCents, bankCents, physicalCents, benefitsCents,
    invoicesCents: live.reduce((s, card) => s + c(card.payable_invoice) + c(card.current_invoice), 0),
    freeLimitCents: live.reduce((s, card) => s + Math.max(0, c(card.available)), 0),
    limitCents: live.reduce((s, card) => s + c(card.limit), 0),
  };
}

/** Parts of the Carteira bar (prototype): accounts, invested, benefits and what is owed on the cards.
 * Shares are of the bar only; the parts are shown apart, never added into one total (v1.1). */
export function composition(ind: WalletIndicators, investedCents = 0): { key: "accounts" | "invested" | "benefits" | "debt"; label: string; cents: number; share: number }[] {
  const parts = [
    { key: "accounts" as const, label: "Nas contas", cents: Math.max(0, ind.cashCents) },
    { key: "invested" as const, label: "Investido", cents: Math.max(0, investedCents) },
    { key: "benefits" as const, label: "Benefícios", cents: Math.max(0, ind.benefitsCents) },
    { key: "debt" as const, label: "A pagar nos cartões", cents: Math.max(0, ind.invoicesCents) },
  ];
  const total = parts.reduce((s, p) => s + p.cents, 0);
  return parts.map((p) => ({ ...p, share: total ? p.cents / total : 0 }));
}

export function upcomingInvoices(cards: CreditCard[], today: string): UpcomingInvoice[] {
  const out: UpcomingInvoice[] = [];
  for (const card of cards.filter((x) => x.active)) {
    const base = { cardId: card.id, cardName: card.name, color: card.color };
    if (c(card.payable_invoice) > 0 && card.payable_due) {
      out.push({ ...base, amountCents: c(card.payable_invoice), due: card.payable_due, state: card.payable_due < today ? "overdue" : "closed" });
    }
    if (c(card.current_invoice) > 0) out.push({ ...base, amountCents: c(card.current_invoice), due: card.next_due, state: "open" });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.cardName.localeCompare(b.cardName, "pt-BR"));
}

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function walletWarnings(accounts: Account[], invoices: UpcomingInvoice[], open: OpenReconciliation[], cards: CreditCard[]): WalletWarning[] {
  const out: WalletWarning[] = [];
  for (const rec of open) {
    const account = accounts.find((a) => a.id === rec.account_id);
    const card = cards.find((x) => x.id === rec.card_id);
    const name = account?.name ?? card?.name;
    if (!name) continue;
    const diff = rec.difference == null ? 0 : c(rec.difference);
    if (diff === 0 && rec.pending === 0) continue;
    out.push({
      key: `rec:${rec.id}`, tone: "attention",
      title: diff ? `Diferença de saldo em ${name}` : `Conferência em aberto em ${name}`,
      detail: diff ? `O ${account ? "extrato" : "PDF da fatura"} mostra ${brl(Math.abs(diff))} ${diff > 0 ? "a mais" : "a menos"} que o FINNOS.` : `${rec.pending} ${rec.pending === 1 ? "item para revisar" : "itens para revisar"}.`,
      to: account ? `/contas/${encodeURIComponent(account.id)}/conferencia` : `/cartoes/${encodeURIComponent(card!.id)}/conferencia${rec.cycle ? `?cycle=${rec.cycle}` : ""}`,
    });
  }
  for (const a of accounts.filter((x) => x.active)) {
    const balance = c(a.balance);
    if (balance < 0) {
      const limit = c(a.overdraft_limit);
      out.push({
        key: `neg:${a.id}`, tone: limit && -balance <= limit ? "attention" : "danger",
        title: limit && -balance <= limit ? `${a.name} usando o cheque especial` : `${a.name} está no negativo`,
        detail: limit ? `${brl(-balance)} de ${brl(limit)} do limite.` : `${brl(balance)}. Confira se falta registrar uma entrada.`,
        to: "/contas",
      });
    }
    for (const w of a.wallets ?? []) {
      if (c(w.balance) < 0) out.push({ key: `wallet:${w.id}`, tone: "attention", title: `${w.name} no negativo`, detail: `${a.name}: ${brl(c(w.balance))}.`, to: "/contas?aba=beneficios" });
    }
  }
  for (const inv of invoices.filter((i) => i.state === "overdue")) {
    out.push({ key: `late:${inv.cardId}`, tone: "danger", title: `Fatura do ${inv.cardName} vencida`, detail: `${brl(inv.amountCents)} venceu em ${inv.due.split("-").reverse().join("/")}.`, to: `/cartoes/${encodeURIComponent(inv.cardId)}` });
  }
  const order = { danger: 0, attention: 1 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** Credit cards for the carousel: the default card in the centre, the others around it. */
export function carouselOrder(cards: CreditCard[]): CreditCard[] {
  const live = cards.filter((x) => x.active);
  const index = live.findIndex((x) => x.is_default);
  if (index < 0 || live.length < 3) return index > 0 ? [live[index], ...live.filter((_, i) => i !== index)] : live;
  const others = live.filter((_, i) => i !== index);
  const middle = Math.floor(live.length / 2);
  return [...others.slice(0, middle), live[index], ...others.slice(middle)];
}


const STOP = new Set(["banco", "bank", "unibanco", "s.a.", "sa", "de", "do", "da", "dos", "das"]);

/** Two letters for the bank's square logo: "Nubank" → Nu, "Banco do Brasil" → BB, "Mercado Pago" → MP. */
export function bankInitials(name: string): string {
  const clean = name.trim();
  if (/^banco d[oa]s? /i.test(clean)) return ("B" + (clean.split(/\s+/).at(-1)?.[0] ?? "")).toUpperCase();
  const words = clean.split(/\s+/).filter((w) => !STOP.has(w.toLocaleLowerCase("pt-BR")));
  if (words.length >= 2 && /^[A-Za-zÀ-ú]/.test(words[1])) return (words[0][0] + words[1][0]).toUpperCase();
  const word = words[0] ?? clean;
  return (word[0] ?? "?").toUpperCase() + (word[1] ?? "").toLocaleLowerCase("pt-BR");
}

export interface BankRow extends WalletGroup {
  initials: string;
  /** Null when the bank has no account (only a credit card). */
  accountsCents: number | null;
  investedCents: number;
  isDefault: boolean;
  products: string;
  empty: boolean;
}

export type BankSort = "saldo" | "az" | "cartao";

/** One row per bank (prototype "Bancos e contas"): accounts, cards and investments of that bank together. */
export function bankRows(accounts: Account[], cards: CreditCard[], institutions: Institution[],
  opts: { investments?: { account?: string | null; current: number }[]; methods?: Record<string, string[]>; query?: string; sort?: BankSort } = {}): BankRow[] {
  const norm = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const q = norm(opts.query ?? "").trim();
  const rows = walletGroups(accounts.filter((a) => a.type !== "beneficio" && a.type !== "carteira"), cards.filter((c) => c.active), institutions)
    .filter((g) => g.accounts.length || g.cards.length)
    .map((g): BankRow => {
      const ids = new Set(g.accounts.map((a) => a.id));
      const invested = (opts.investments ?? []).filter((i) => i.account && ids.has(i.account)).reduce((s, i) => s + c(i.current), 0);
      const products: string[] = [];
      if (g.accounts.some((a) => a.type !== "poupanca")) products.push("Conta");
      if (g.accounts.some((a) => a.type === "poupanca")) products.push("Poupança");
      const methods = new Set(g.accounts.flatMap((a) => opts.methods?.[a.id] ?? ["Pix", "Débito"]));
      for (const m of ["Pix", "Débito"]) if (methods.has(m) && g.accounts.length) products.push(m);
      if (g.cards.length) products.push("Crédito");
      const label = g.accounts.length ? products.join(" · ") : "Só cartão de crédito";
      const debt = g.cards.some((x) => c(x.current_invoice) + c(x.payable_invoice) > 0);
      return {
        ...g, initials: bankInitials(g.name), accountsCents: g.accounts.length ? g.balanceCents : null, investedCents: invested,
        isDefault: g.accounts.some((a) => a.is_default) || g.cards.some((x) => x.is_default),
        products: invested ? `${label} · Investido` : label,
        empty: g.balanceCents === 0 && !debt && !invested,
      };
    })
    .filter((r) => !q || norm(r.name).includes(q) || r.accounts.some((a) => norm(a.name).includes(q)) || r.cards.some((x) => norm(x.name).includes(q)));
  const sort = opts.sort ?? "saldo";
  return rows.sort((a, b) => {
    if (sort === "az") return a.name.localeCompare(b.name, "pt-BR");
    if (sort === "cartao") return Number(b.cards.length > 0) - Number(a.cards.length > 0) || (b.accountsCents ?? 0) - (a.accountsCents ?? 0);
    return Number(b.isDefault) - Number(a.isDefault) || (b.accountsCents ?? -1) - (a.accountsCents ?? -1) || a.name.localeCompare(b.name, "pt-BR");
  });
}

/** Benefit tiles: one per benefit (a multi card gives one tile for each of its benefits). */
export function benefitTiles(accounts: Account[]) {
  return accounts.filter((a) => a.type === "beneficio" && a.active).flatMap((a) => {
    const wallets = a.wallets?.length ? a.wallets : [{ id: a.id, name: a.name, balance: a.balance, monthly_amount: 0, day: 1, daily_allowance: 0, next_recharge: null, runs_out_on: null, is_default: true, allow_negative: false, initial_balance: 0 }];
    return wallets.map((w) => ({
      key: `${a.id}:${w.id}`, account: a, name: wallets.length > 1 || w.name !== a.name ? w.name : a.name, cardName: a.name,
      cents: c(w.balance), monthlyCents: c(w.monthly_amount), day: w.day, nextRecharge: w.next_recharge ?? null, runsOut: w.runs_out_on ?? null,
      /** Share left of the monthly amount (capped at 100%). */
      left: w.monthly_amount > 0 ? Math.max(0, Math.min(1, w.balance / w.monthly_amount)) : null,
    }));
  });
}
