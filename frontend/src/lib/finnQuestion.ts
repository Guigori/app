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
  | "balance" | "forecast" | "upcoming" | "budget" | "subscriptions" | "save" | "radar"
  | "unusual" | "runway" | "months" | "goals" | "find";

export interface Entity { kind: "category" | "account" | "card" | "merchant" | "goal"; id?: string; name: string; term: string }

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
  /** "Dura até o dia 15?": the day asked about. */
  day?: number;
  /** Words the question asks about that match nothing in the data ("padaria" with no Padaria anywhere). */
  unknown?: string[];
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
  /** The user's goals, so "a meta do notebook" is recognised. */
  goals?: { id: string; name: string }[];
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
  if (/\b(quando (foi|paguei|comprei|gastei|recebi|pago|caiu)|ultima vez|ultim[oa] (gasto|pagamento|lancamento|compra|vez)|procur\w*|busc\w*|pesquis\w*|ache\b|achar|localiz\w*|mostre (os |as )?(lancamentos|compras|gastos)|lancamentos (de|do|da|com)|compras (de|do|da|no|na))\b/.test(q)) return "find";
  if (/\bcompar|\bversus\b|\bvs\b|\bcontra\b|diferenca entre/.test(q) || (entityCount >= 2 && /\b(ou|e)\b/.test(q))) return "compare";
  if (/\b(metas?|objetivos?)\b/.test(q)) return "goals";
  if (/\b(mais (do )?que o (normal|costume|habitual)|acima do (normal|habitual|costume)|fora do normal|mais que de costume)\b/.test(q)) return "unusual";
  if (/\b(dura|durar|aguent\w*|chega|chegar|sobra ate|da ate)\b/.test(q) && /\b(ate|dia|salario|pagamento|fim do mes)\b/.test(q)) return "runway";
  if (/\b(quais|qual|que) (os |foram os )?(meses|mes)\b/.test(q) || /\bmeses mais (caros|pesados)\b/.test(q)) return "months";
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

/** Everyday words for a category ("remédio" → Saúde/Farmácia): tried when the category's own name is not in the question. */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/\b(comida|comer|almoco|jantar|lanche|lanches|refeic\w*)\b/, ["alimentacao", "restaurantes", "restaurante"]],
  [/\b(delivery|ifood|rappi)\b/, ["restaurantes", "restaurante", "alimentacao", "delivery"]],
  [/\b(supermercado|feira|compras do mes|hortifruti)\b/, ["mercado", "supermercado", "alimentacao"]],
  [/\b(remedio|remedios|farmacia|drogaria|medico|consulta|exame|dentista|plano de saude)\b/, ["saude", "farmacia"]],
  [/\b(gasolina|combustivel|uber|99|taxi|onibus|metro|estacionamento|pedagio|carro)\b/, ["transporte", "combustivel", "carro"]],
  [/\b(aluguel|condominio|luz|energia|agua|gas|internet|iptu)\b/, ["moradia", "casa", "contas da casa"]],
  [/\b(streaming|netflix|spotify|assinaturas?)\b/, ["assinaturas", "assinatura", "streaming"]],
  [/\b(cinema|show|bar|balada|viagem|passeio|diversao)\b/, ["lazer", "entretenimento", "viagem"]],
  [/\b(roupa|roupas|tenis|sapato|vestuario)\b/, ["vestuario", "compras", "roupas"]],
  [/\b(escola|faculdade|curso|livro|livros)\b/, ["educacao", "cursos"]],
  [/\b(salario|pagamento do trabalho)\b/, ["salario", "renda"]],
  [/\b(academia|treino)\b/, ["saude", "academia", "esporte"]],
];
/** Words after a preposition that are not a thing to look up. */
const NOT_SUBJECT = new Set(("positivo negativo vermelho azul normal costume habitual geral ritmo dinheiro reais real juros credito debito " +
  "pix boleto vista prazo parcelado parcelada parcelas parcela fixo fixos fixas variavel variaveis compras gastos lancamento lancamentos " +
  "novo nova primeiro primeira segunda terca quarta quinta sexta sabado domingo manha tarde noite fim inicio meio semanal mensal anual " +
  "maneira forma jeito vida casa uma uns umas meta metas plano planos").split(" "));
/** Plural and small typos still match ("farmacias", "suplementos", "restaurnte"). */
const stem = (w: string) => w.replace(/(oes|aes)$/, "ao").replace(/(is)$/, "l").replace(/s$/, "");
function close(x: string, y: string): boolean {
  if (x === y) return true;
  const a = stem(x), b = stem(y);
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  // One letter added, missing or changed.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** The word right after "com", "de", "no"… is what the question is about. */
export function askedSubjects(q: string): string[] {
  const out: string[] = [];
  for (const m of q.matchAll(/\b(?:com|de|do|da|dos|das|no|na|nos|nas|em|pelo|pela)\s+([a-z0-9][a-z0-9]{2,})/g)) {
    const w = m[1];
    if (!STOP.has(w) && !NOT_SUBJECT.has(w) && !/^\d/.test(w) && !Object.keys(NUMBERS).includes(w)) out.push(w);
  }
  return [...new Set(out)];
}

/** Recognises categories, accounts, cards and establishments named in the question. */
export function findEntities(q: string, ctx: QuestionContext): Entity[] {
  const found: Entity[] = [];
  // A goal named in the question ("meta do notebook"): its distinctive words are enough.
  for (const g of ctx.goals ?? []) {
    const words = norm(g.name).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !["meta", "minha", "novo", "nova"].includes(w));
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) found.push({ kind: "goal", id: g.id, name: g.name, term: norm(g.name) });
  }
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
    if (hit) { found.push({ kind: "merchant", name: w.charAt(0).toUpperCase() + w.slice(1), term: w }); continue; }
    // Plural or a typo of a category ("farmacias", "restaurnte").
    const cat = ctx.categories.find((c) => norm(c.name).split(" ").some((cw) => close(w, cw)));
    if (cat && !found.some((e) => e.id === cat.id)) { found.push({ kind: "category", id: cat.id, name: cat.name, term: w }); continue; }
    // Plural or a typo of an establishment: the word of the name that is close is the term.
    const near = ctx.names.flatMap((name) => name.split(" ")).find((nw) => nw.length >= 4 && close(w, nw));
    if (near && !found.some((e) => e.term === near)) found.push({ kind: "merchant", name: near.charAt(0).toUpperCase() + near.slice(1), term: near });
  }
  // Nothing by name: everyday words for a category the person has.
  if (!found.some((e) => e.kind === "category")) {
    for (const [re, names] of SYNONYMS) {
      if (!re.test(q)) continue;
      const cat = ctx.categories.find((c) => names.includes(norm(c.name)));
      if (cat && !found.some((e) => e.id === cat.id) && !found.some((e) => e.kind === "merchant" && re.test(e.term))) { found.push({ kind: "category", id: cat.id, name: cat.name, term: norm(cat.name) }); break; }
    }
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
  // A new name ("e com padaria?") is a new subject, even when nothing matched it.
  const named = askedSubjects(q).length > 0;
  const followUp = Boolean(previousQuery) && !entities.length && !named && (/^e\b/.test(q) || ((explicit || Boolean(op)) && q.split(" ").length <= 6));
  if (followUp && previousQuery) {
    entities = previousQuery.entities;
    if (!income && !/\bgast|\bdespes/.test(q)) type = previousQuery.type;
    op = op ?? (previousQuery.op === "compare" ? "total" : previousQuery.op);
  }
  // "comparado com o mês passado": the comparison is between periods, not entities.
  const versusPast = /\b(mes passado|mes anterior|periodo anterior|ano passado)\b/.test(q) && /\bcompar|\bvs\b|\bcontra\b|\bem relacao\b/.test(q);
  let current = versusPast ? parsePeriod(q.replace(/\b(mes passado|mes anterior|ano passado)\b/g, ""), ctx.today).period : p;
  // "Quais meses custaram mais?" looks at the year unless a period is named.
  if (op === "months" && !explicit) current = parsePeriod("este ano", ctx.today).period;
  const resolved = op ?? (entities.length ? "total" : "total");
  // "Quando comprei…" looks back two years unless a period is named.
  if (resolved === "find" && !explicit) current = period(monthStart(addMonth(ctx.today.slice(0, 7), -23)), shiftDays(ctx.today, 60), "últimos 24 meses");
  const matched = new Set(entities.flatMap((e) => e.term.split(" ")));
  const lookup = ["total", "count", "average", "top", "trend", "compare", "find", "save", "unusual"].includes(resolved);
  const unknown = followUp || !lookup ? [] : askedSubjects(q).filter((w) => !matched.has(w) && !entities.some((e) => close(w, e.term) || norm(e.name).split(" ").some((x) => close(w, x))) && !SYNONYMS.some(([re]) => re.test(w) && entities.some((e) => e.kind === "category")));
  return {
    op: resolved === "compare" && entities.length < 2 ? "compare" : resolved,
    type,
    period: current,
    previous: previousPeriod(current),
    entities,
    vague: !op && !entities.length && !explicit && !unknown.length,
    unknown,
    day: Number(q.match(/\bdia (\d{1,2})\b/)?.[1]) || undefined,
    single: /\b(maior|mais cara?) (gasto|compra|despesa|lancamento|receita|entrada)\b/.test(q) && !/\bcategoria/.test(q),
  };
}
