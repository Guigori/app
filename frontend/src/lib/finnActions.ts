/**
 * FINNOS IA proposals: what a message asks to change (register lançamentos, move them to another
 * category, start following subscriptions) turned into a proposal the user reviews. Nothing here
 * writes: lib/finnApply saves only after the user confirms.
 */
import { parseRegisterText } from "@/lib/registerParsing";
import { norm } from "@/lib/finnQuestion";
import { nextMonthlyDate } from "@/lib/subscriptionsView";
import type { Account, Category, SubscriptionItem, Transaction } from "@/types/finnos";

export interface ProposedEntry {
  key: string;
  include: boolean;
  name: string;
  value: number;
  type: "despesa" | "receita";
  date: string;
  accountId: string;
  categoryId: string | null;
}

export interface SubscriptionCandidate {
  key: string;
  include: boolean;
  name: string;
  value: number;
  nextCharge: string;
  accountId: string;
  cardId: string | null;
  categoryId: string | null;
  months: number;
}

export type Proposal =
  | { kind: "register"; entries: ProposedEntry[]; unknown: string[] }
  | { kind: "recategorize"; term: string; toCategoryId: string; toName: string; ids: string[]; total: number; from: { name: string; count: number }[] }
  | { kind: "subscriptions"; candidates: SubscriptionCandidate[] };

/** What happened to a proposal, kept so it can be undone. */
export type ProposalState =
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "applied"; createdIds?: string[]; previous?: { id: string; categoryId: string | null }[]; subscriptionIds?: string[] }
  | { status: "undone" };

export interface ActionContext {
  today: string;
  accounts: Account[];
  categories: Category[];
  /** Recent lançamentos: categories people already use for a name, and recurring payments. */
  transactions: Transaction[];
  subscriptions: SubscriptionItem[];
  aliases: Record<string, string>;
}

const QUESTION = /\b(quanto|quantos|quantas|qual|quais|como|onde|quando|por que|porque|posso|consigo|cabe|da pra|vale a pena|parcel\w*|dura|durar|aguenta|vai|vou|sera|devo|tenho)\b/;
const LEAD_VERB = /^\s*(?:por favor,?\s+)?(?:registr[ae]r?|anot[ae]r?|lan[cç][ae]r?|adicion[ae]r?|inclu[ia]r?)\b:?\s*/i;
const REGISTER_VERB = /\b(gastei|paguei|comprei|recebi|ganhei)\b/;
const AMOUNT_RE = /(?:r\$\s*)?\d+(?:[.,]\d{1,2})?/;

/** The most used account in recent lançamentos, else the first active one. */
function defaultAccount(ctx: ActionContext): string | null {
  const counts = new Map<string, number>();
  for (const tx of ctx.transactions) counts.set(tx.account_id, (counts.get(tx.account_id) ?? 0) + 1);
  const active = ctx.accounts.filter((a) => a.active !== false);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).find((id) => active.some((a) => a.id === id)) ?? active[0]?.id ?? null;
}

/** Category for a name: what the user taught, what they already use for it, then the words. */
function categoryFor(name: string, guessed: string | null, ctx: ActionContext): string | null {
  const words = norm(name).split(" ");
  const taught = Object.entries(ctx.aliases).find(([term]) => words.includes(term) || norm(name) === term)?.[1];
  if (taught && ctx.categories.some((c) => c.id === taught)) return taught;
  const used = new Map<string, number>();
  for (const tx of ctx.transactions) {
    if (!tx.category_id || norm(tx.name) !== norm(name)) continue;
    used.set(tx.category_id, (used.get(tx.category_id) ?? 0) + 1);
  }
  const habit = [...used.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return habit ?? guessed;
}

/** "café 3,80 e táxi 14 hoje", "anota 45 de mercado no nubank": one entry per amount. */
export function registerProposal(text: string, ctx: ActionContext): Proposal | null {
  const q = norm(text);
  // norm() drops "?", so the question mark is read from the original text.
  if (text.includes("?") || QUESTION.test(q) || /\b(transferi|transferencia)\b/.test(q)) return null;
  // "uber nos últimos 3 meses" is about a period, not something to register.
  if (/\b(meses|semanas|anos|vezes|ultim[oa]s?|media|total|compar\w*|evolucao|porcento)\b|%/.test(q)) return null;
  const asked = LEAD_VERB.test(text);
  // Split on "e", ";", "+" and on commas that are not a decimal separator ("3,80").
  const clauses = text.replace(LEAD_VERB, "")
    .split(/\s*(?:;|\+|\be\b|\btamb[eé]m\b)\s*|,(?!\d)\s*/i).map((c) => c.trim()).filter(Boolean);
  const withAmount = clauses.filter((c) => AMOUNT_RE.test(norm(c)) && !/^\d{1,2}\/\d{1,2}/.test(c.trim()));
  if (!withAmount.length) return null;
  // A bare list ("café 3,80 e táxi 14") counts as a request; anything else needs a verb.
  const shortList = withAmount.length >= 2 || clauses.length <= 2;
  if (!asked && !REGISTER_VERB.test(q) && !shortList) return null;
  const account = defaultAccount(ctx);
  if (!account) return null;
  const whole = parseRegisterText(text, { accounts: ctx.accounts, categories: ctx.categories, today: ctx.today });
  const entries: ProposedEntry[] = [];
  const unknown: string[] = [];
  for (const clause of clauses) {
    const parsed = parseRegisterText(clause, { accounts: ctx.accounts, categories: ctx.categories, today: ctx.today });
    const leftover = norm(clause).replace(/\b(hoje|ontem|anteontem|e|de|da|do|no|na|com|um|uma|reais|real)\b/g, "").trim();
    if (!parsed.value) {
      if (leftover && !/^(dia \d+|\d{1,2}\/\d{1,2})$/.test(leftover)) unknown.push(clause);
      continue;
    }
    const name = parsed.name || "Lançamento";
    entries.push({
      key: `${entries.length}-${name}`,
      include: true,
      name,
      value: parsed.value,
      type: parsed.kind === "Receita" ? "receita" : "despesa",
      date: parsed.date ?? whole.date ?? ctx.today,
      accountId: parsed.accountId ?? whole.accountId ?? account,
      categoryId: categoryFor(name, parsed.categoryId, ctx),
    });
  }
  return entries.length ? { kind: "register", entries, unknown } : null;
}

/** "mova todas as compras da Padaria para Alimentação". */
export function recategorizeProposal(text: string, ctx: ActionContext): Proposal | { error: string } | null {
  const q = norm(text);
  const m = q.match(/\b(?:mova|mover|mude|mudar|coloque|colocar|passe|passar|troque|trocar|transfira|recategorize|jogue)\b\s+(?:todas?|todos?)?\s*(?:as|os)?\s*(?:compras|lancamentos|gastos|despesas|pagamentos)?\s*(?:do|da|de|dos|das|no|na|em)?\s*(.+?)\s+(?:para|pra|em)\s+(?:a\s+|o\s+)?(?:categoria\s+)?(.+?)$/);
  if (!m) return null;
  const term = m[1].replace(/\b(o|a|os|as)\b/g, "").trim();
  const target = m[2].replace(/[.!]+$/, "").trim();
  const category = ctx.categories.find((c) => norm(c.name) === target) ?? ctx.categories.find((c) => target.includes(norm(c.name)) || norm(c.name).includes(target));
  if (!category) return { error: `Não encontrei a categoria "${m[2]}". Confira o nome em Categorias.` };
  const rows = ctx.transactions.filter((tx) => tx.type !== "transferencia" && tx.category_id !== category.id && (norm(tx.name).split(" ").includes(term) || norm(tx.name).includes(term)));
  const from = new Map<string, number>();
  for (const tx of rows) from.set(tx.category_name ?? "Sem categoria", (from.get(tx.category_name ?? "Sem categoria") ?? 0) + 1);
  return {
    kind: "recategorize", term, toCategoryId: category.id, toName: category.name,
    ids: rows.map((tx) => tx.id), total: Math.round(rows.reduce((s, tx) => s + tx.value, 0) * 100) / 100,
    from: [...from.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

/** Expenses that came back in at least three months with a steady value, not yet in Assinaturas. */
export function subscriptionsProposal(text: string, ctx: ActionContext): Proposal | null {
  const q = norm(text);
  if (!/\bassinatura/.test(q) || !/\b(encontr|ache|achar|procur|descubr|parecem|parece|faltam|falta|nao (estao|cadastr)|sugir)/.test(q)) return null;
  const registered = new Set(ctx.subscriptions.map((s) => norm(s.name)));
  const groups = new Map<string, Transaction[]>();
  for (const tx of ctx.transactions) {
    if (tx.type !== "despesa" || tx.installment) continue;
    const key = norm(tx.name);
    if (!key || registered.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  const candidates: SubscriptionCandidate[] = [];
  for (const rows of groups.values()) {
    const months = new Set(rows.map((tx) => tx.date.slice(0, 7)));
    if (months.size < 3) continue;
    const values = rows.map((tx) => tx.value);
    if (Math.max(...values) > Math.min(...values) * 1.25) continue;
    const last = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
    candidates.push({
      key: last.id, include: true, name: last.name,
      value: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100,
      nextCharge: last.date >= ctx.today ? last.date : nextMonthlyDate(last.date, ctx.today),
      accountId: last.account_id, cardId: last.card_id, categoryId: last.category_id, months: months.size,
    });
  }
  return { kind: "subscriptions", candidates: candidates.sort((a, b) => b.value - a.value).slice(0, 8) };
}

/** The first proposal a message asks for, if any. */
export function proposalFor(text: string, ctx: ActionContext): Proposal | { error: string } | null {
  return subscriptionsProposal(text, ctx) ?? recategorizeProposal(text, ctx) ?? registerProposal(text, ctx);
}
