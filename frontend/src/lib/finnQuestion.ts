/**
 * FINNOS IA, analyst part: turns a free question in Portuguese into a structured query
 * (period, what is being asked, and which category / account / card / establishment).
 * Pure and deterministic, so it runs in every mode without a paid model.
 */
import { addMonth, toLocalISO } from "@/lib/format";

export const norm = (text: string) =>
  text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9$,.\s]/g, " ").replace(/\s+/g, " ").trim();

export interface Period { start: string; end: string; label: string; months: string[] }

export type Operation =
  | "total" | "count" | "average" | "top" | "trend" | "compare"
  | "balance" | "forecast" | "upcoming" | "budget" | "subscriptions" | "save" | "radar";

export interface Entity { kind: "category" | "account" | "card" | "merchant"; id?: string; name: string; term: string }

export interface FinnQuery {
  op: Operation;
  type: "despesa" | "receita";
  period: Period;
  /** The period the answer compares against (previous of the same length, or one asked for). */
  previous: Period;
  entities: Entity[];
  /** True when nothing in the question was understood beyond the defaults. */
  vague: boolean;
  /** "Qual foi meu maior gasto": one lançamento, not a ranking of categories. */
  single?: boolean;
}

export interface QuestionContext {
  today: string;
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string; institution?: string | null }[];
  cards: { id: string; name: string }[];
  /** Normalized names of recent lançamentos, to recognise establishments ("uber", "ifood"). */
  names: string[];
  /** User-taught aliases, normalized term → category id. */
  aliases?: Record<string, string>;
}

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
/** Words that never name an establishment. */
const STOP = new Set(("a o os as de da do das dos e em no na nos nas com por para pra pro que qual quais quanto quanta quantos quantas eu meu minha meus minhas " +
  "gastei gasto gastos gastar paguei pago pagar despesa despesas receita receitas recebi receber entrou entrada entradas saiu saida saidas ganhei " +
  "mes meses ano anos semana semanas dia dias hoje ontem ultimo ultimos ultima ultimas passado passada anterior este esta esse essa neste nesta nesse nessa " +
  "total media maior maiores menor top lista onde mais menos comparado comparar compare comparacao versus vs contra ou foi foram tenho tive ate desde agora " +
  "categoria categorias conta contas cartao cartoes valor valores vezes vez me mostre mostra quero ver sobre todo toda todos todas como esta estou " +
  "evolucao tendencia historico orcamento limite saldo assinatura assinaturas vence vencimento proximas proximos previsto previsao projecao fechar sobrar " +
  MONTHS.join(" ") + " " + SHORT.join(" ")).split(" "));

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${m}-${pad(new Date(y, mo, 0).getDate())}`; };
const monthsBetween = (start: string, end: string) => {
  const out: string[] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = addMonth(m, 1)) out.push(m);
  return out;
};
const shiftDays = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return toLocalISO(d); };
const period = (start: string, end: string, label: string): Period => ({ start, end, label, months: monthsBetween(start, end) });
const monthName = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][mo - 1]} de ${y}`; };
const wholeMonth = (m: string, label?: string) => period(monthStart(m), monthEnd(m), label ?? monthName(m));

/** The period a question speaks about; the current month when it names none. */
export function parsePeriod(q: string, today: string): { period: Period; explicit: boolean } {
  const month = today.slice(0, 7);
  const count = (word: string) => NUMBERS[word] ?? Number(word);
  let m: RegExpMatchArray | null;
  if (/\bhoje\b/.test(q)) return { period: period(today, today, "hoje"), explicit: true };
  if (/\bontem\b/.test(q)) { const d = shiftDays(today, -1); return { period: period(d, d, "ontem"), explicit: true }; }
  if ((m = q.match(/\bultim[oa]s? (\d+|[a-z]+) (dias|semanas|meses|anos)\b/)) && Number.isFinite(count(m[1]))) {
    const n = count(m[1]);
    if (m[2] === "dias") return { period: period(shiftDays(today, -(n - 1)), today, `últimos ${n} dias`), explicit: true };
    if (m[2] === "semanas") return { period: period(shiftDays(today, -(n * 7 - 1)), today, `últimas ${n} semanas`), explicit: true };
    const first = addMonth(month, -((m[2] === "anos" ? n * 12 : n) - 1));
    return { period: period(monthStart(first), today, `últimos ${m[2] === "anos" ? n * 12 : n} meses`), explicit: true };
  }
  if (/\b(semana passada|ultima semana)\b/.test(q)) {
    const d = new Date(`${today}T12:00:00`); const monday = shiftDays(today, -((d.getDay() + 6) % 7));
    return { period: period(shiftDays(monday, -7), shiftDays(monday, -1), "semana passada"), explicit: true };
  }
  if (/\b(essa|esta|nesta|nessa) semana\b/.test(q)) {
    const d = new Date(`${today}T12:00:00`);
    return { period: period(shiftDays(today, -((d.getDay() + 6) % 7)), today, "esta semana"), explicit: true };
  }
  if (/\b(mes passado|mes anterior|ultimo mes)\b/.test(q)) return { period: wholeMonth(addMonth(month, -1)), explicit: true };
  if (/\bano passado\b/.test(q)) { const y = Number(today.slice(0, 4)) - 1; return { period: period(`${y}-01-01`, `${y}-12-31`, `${y}`), explicit: true }; }
  if (/\b(este|esse|neste|nesse) ano\b|\bno ano\b/.test(q)) return { period: period(`${today.slice(0, 4)}-01-01`, today, `${today.slice(0, 4)} até hoje`), explicit: true };
  const named = MONTHS.findIndex((name, i) => new RegExp(`\\b(${name}|${SHORT[i]})\\b`).test(q));
  if (named >= 0) {
    const year = q.match(/\b(20\d{2})\b/)?.[1];
    let y = year ? Number(year) : Number(today.slice(0, 4));
    if (!year && `${y}-${pad(named + 1)}` > month) y -= 1;
    return { period: wholeMonth(`${y}-${pad(named + 1)}`), explicit: true };
  }
  if (/\b(este|esse|neste|nesse) mes\b|\bdo mes\b|\bno mes\b/.test(q)) return { period: wholeMonth(month, "este mês"), explicit: true };
  return { period: wholeMonth(month, "este mês"), explicit: false };
}

/** The period just before, of the same length (a whole month compares with the whole previous one). */
export function previousPeriod(p: Period): Period {
  const wholeMonths = p.start.endsWith("-01") && p.end === monthEnd(p.end.slice(0, 7));
  if (wholeMonths) {
    const n = p.months.length;
    const first = addMonth(p.months[0], -n);
    return period(monthStart(first), monthEnd(addMonth(first, n - 1)), n === 1 ? monthName(first) : `${n} meses anteriores`);
  }
  const days = Math.round((new Date(`${p.end}T12:00:00`).getTime() - new Date(`${p.start}T12:00:00`).getTime()) / 86_400_000) + 1;
  const end = shiftDays(p.start, -1);
  return period(shiftDays(end, -(days - 1)), end, "período anterior");
}

function operation(q: string, entityCount: number): Operation | null {
  if (/\bcompar|\bversus\b|\bvs\b|\bcontra\b|diferenca entre/.test(q) || (entityCount >= 2 && /\b(ou|e)\b/.test(q))) return "compare";
  if (/\b(econom|cortar|reduzir|gastar menos|guardar mais)/.test(q)) return "save";
  if (/\b(radar|alerta|alertas|atencao|preocupar|risco)\b/.test(q)) return "radar";
  if (/\bassinatura/.test(q)) return "subscriptions";
  if (/\b(vence|vencem|vencimento|a pagar|contas a pagar|proximas contas|proximos pagamentos)\b/.test(q)) return "upcoming";
  if (/\b(orcamento|limite|posso gastar|quanto ainda|ainda posso|resta|restam|sobrou do)\b/.test(q)) return "budget";
  if (/\b(sobrar|fechar o mes|fim do mes|final do mes|projecao|previsao|previsto|vai faltar|vou fechar)\b/.test(q)) return "forecast";
  if (/\b(saldo|quanto tenho|dinheiro (na|em) conta|tenho em conta)\b/.test(q) && !/\bgast|\bdespes|\breceb/.test(q)) return "balance";
  if (/\b(evolucao|por mes|mes a mes|tendencia|ao longo|historico|cada mes)\b/.test(q)) return "trend";
  if (/\bquantas vezes\b|\bquantos lancamentos\b|\bquantas compras\b|\bquantas corridas\b/.test(q)) return "count";
  if (/\bmedia\b|\bem media\b/.test(q)) return "average";
  if (/\b(maior|maiores|top|onde|quais|lista|listar|principais|ranking|mais gastei|gastei mais|gasto mais|mais caro)\b/.test(q)) return "top";
  if (/\b(quanto|total|gastei|gasto|paguei|recebi|entrou|ganhei|saiu)\b/.test(q)) return "total";
  return null;
}

/** Recognises categories, accounts, cards and establishments named in the question. */
export function findEntities(q: string, ctx: QuestionContext): Entity[] {
  const found: Entity[] = [];
  const has = (term: string) => term.length >= 3 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q);
  for (const c of ctx.categories) { const t = norm(c.name); if (has(t)) found.push({ kind: "category", id: c.id, name: c.name, term: t }); }
  for (const [alias, id] of Object.entries(ctx.aliases ?? {})) {
    const c = ctx.categories.find((x) => x.id === id);
    if (c && has(alias) && !found.some((e) => e.id === id)) found.push({ kind: "category", id, name: c.name, term: alias });
  }
  for (const c of ctx.cards) { const t = norm(c.name); if (has(t)) found.push({ kind: "card", id: c.id, name: c.name, term: t }); }
  for (const a of ctx.accounts) {
    const t = norm(a.name);
    if (has(t) && !found.some((e) => e.term === t)) found.push({ kind: "account", id: a.id, name: a.name, term: t });
  }
  const taken = new Set(found.flatMap((e) => e.term.split(" ")));
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !taken.has(w) && !/^\d/.test(w) && !w.startsWith("r$"));
  for (const w of words) {
    if (found.some((e) => e.kind === "merchant" && e.term === w)) continue;
    const hit = ctx.names.find((name) => name.split(" ").includes(w) || name === w);
    if (hit) found.push({ kind: "merchant", name: w.charAt(0).toUpperCase() + w.slice(1), term: w });
  }
  return found;
}

/**
 * The whole question. `previousQuery` lets a short follow-up ("e no mês passado?") keep
 * what the last question was about.
 */
export function parseQuestion(text: string, ctx: QuestionContext, previousQuery?: FinnQuery | null): FinnQuery {
  const q = norm(text);
  const { period: p, explicit } = parsePeriod(q, ctx.today);
  let entities = findEntities(q, ctx);
  const income = /\b(recebi|receita|receitas|entrou|entradas|ganhei|renda|faturei)\b/.test(q);
  let type: FinnQuery["type"] = income ? "receita" : "despesa";
  let op = operation(q, entities.length);
  // Only a question that still asks something ("e no mês passado?", "e a média?") inherits the subject.
  const followUp = Boolean(previousQuery) && !entities.length && (/^e\b/.test(q) || ((explicit || Boolean(op)) && q.split(" ").length <= 6));
  if (followUp && previousQuery) {
    entities = previousQuery.entities;
    if (!income && !/\bgast|\bdespes/.test(q)) type = previousQuery.type;
    op = op ?? (previousQuery.op === "compare" ? "total" : previousQuery.op);
  }
  // "comparado com o mês passado": the comparison is between periods, not entities.
  const versusPast = /\b(mes passado|mes anterior|periodo anterior|ano passado)\b/.test(q) && /\bcompar|\bvs\b|\bcontra\b|\bem relacao\b/.test(q);
  const current = versusPast ? parsePeriod(q.replace(/\b(mes passado|mes anterior|ano passado)\b/g, ""), ctx.today).period : p;
  const resolved = op ?? (entities.length ? "total" : "total");
  return {
    op: resolved === "compare" && entities.length < 2 ? "compare" : resolved,
    type,
    period: current,
    previous: previousPeriod(current),
    entities,
    vague: !op && !entities.length && !explicit,
    single: /\b(maior|mais cara?) (gasto|compra|despesa|lancamento|receita|entrada)\b/.test(q) && !/\bcategoria/.test(q),
  };
}
