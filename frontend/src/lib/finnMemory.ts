/**
 * FINNOS IA memory: what the user taught (an establishment counts as a category, a note about it),
 * how they like answers, and what they ask most. Kept in local storage and, signed in, synced to
 * the account with the other app preferences. Small by design: it must fit one preference value.
 */
import { norm, type FinnQuery } from "@/lib/finnQuestion";

export interface FinnMemory {
  v: 1;
  /** Normalized term → category id ("lanche" counts as Restaurantes). */
  aliases: Record<string, string>;
  /** Normalized term → what the user said about it ("uber" → "Uber é trabalho"). */
  notes: Record<string, string>;
  style: "curto" | "normal" | "detalhado";
  /** Topic → how often it was asked and the last wording, for personal suggestions. */
  topics: Record<string, { n: number; q: string }>;
  /** Operation → 👍 / 👎 counts. */
  feedback: Record<string, { up: number; down: number }>;
}

export const MEMORY_KEY = "finnos:finn-memory:v1";
export const MEMORY_EVENT = "finnos-finn-memory";
const LIMITS = { aliases: 30, notes: 20, topics: 15, note: 120 };

export const emptyMemory = (): FinnMemory => ({ v: 1, aliases: {}, notes: {}, style: "normal", topics: {}, feedback: {} });

export function readMemory(): FinnMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null") as Partial<FinnMemory> | null;
    return raw && raw.v === 1 ? { ...emptyMemory(), ...raw } : emptyMemory();
  } catch {
    return emptyMemory();
  }
}

const keep = <T,>(record: Record<string, T>, max: number, score: (v: T) => number = () => 0) =>
  Object.fromEntries(Object.entries(record).sort((a, b) => score(b[1]) - score(a[1])).slice(0, max));

export function writeMemory(memory: FinnMemory): void {
  const trimmed: FinnMemory = {
    ...memory,
    aliases: keep(memory.aliases, LIMITS.aliases),
    notes: keep(memory.notes, LIMITS.notes),
    topics: keep(memory.topics, LIMITS.topics, (t) => t.n),
  };
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new Event(MEMORY_EVENT));
  } catch {
    // Storage full or blocked: the assistant keeps working without remembering.
  }
}

export interface MemoryReply { text: string; memory: FinnMemory; followUps?: string[] }

const QUOTES = /["“”']/g;

/** "lembre que lanche é restaurantes", "esqueça uber", "o que você sabe sobre mim?", "responda mais curto". */
export function memoryCommand(text: string, memory: FinnMemory, categories: { id: string; name: string }[]): MemoryReply | null {
  const raw = text.trim().replace(QUOTES, "");
  const q = norm(raw);
  if (/\b(o que voce (sabe|lembra|aprendeu)|suas memorias|o que voce guardou|memoria)\b/.test(q)) {
    const lines = [
      ...Object.entries(memory.aliases).map(([term, id]) => `${term} conta como ${categories.find((c) => c.id === id)?.name ?? "uma categoria removida"}`),
      ...Object.values(memory.notes),
    ];
    const style = memory.style === "normal" ? "" : ` Você prefere respostas ${memory.style === "curto" ? "curtas" : "detalhadas"}.`;
    return {
      text: lines.length || style ? `Isto é o que eu guardei:\n${lines.map((l) => `• ${l}`).join("\n")}${style}\n\nPara apagar, diga "esqueça" e o nome.` : "Ainda não guardei nada sobre você. Você pode me ensinar, por exemplo: \"lembre que lanche conta como Restaurantes\".",
      memory,
    };
  }
  if (/\b(responda|respostas?|seja) (mais )?(curt|breve|rapid|diret)/.test(q)) return { text: "Combinado: daqui em diante respondo de forma curta, só com o principal.", memory: { ...memory, style: "curto" } };
  if (/\b(mais detalh|detalhe mais|respostas? (mais )?complet|explique mais)/.test(q)) return { text: "Combinado: vou trazer mais detalhes e listas nas respostas.", memory: { ...memory, style: "detalhado" } };
  if (/\b(responda|respostas?) (normal|padrao)\b/.test(q)) return { text: "Combinado: voltei ao jeito normal de responder.", memory: { ...memory, style: "normal" } };

  const forget = q.match(/^(?:pode )?esque(?:c|ç)a(?:-se)?(?: de| que| o| a)? (.+)$/) ?? q.match(/^esquece(?: de| que| o| a)? (.+)$/);
  if (forget) {
    const term = forget[1].replace(/[?.!]+$/, "").trim();
    const aliases = Object.fromEntries(Object.entries(memory.aliases).filter(([t]) => t !== term && !term.includes(t)));
    const notes = Object.fromEntries(Object.entries(memory.notes).filter(([t]) => t !== term && !term.includes(t)));
    const removed = Object.keys(memory.aliases).length + Object.keys(memory.notes).length - Object.keys(aliases).length - Object.keys(notes).length;
    return { text: removed ? `Pronto, esqueci o que sabia sobre ${term}.` : `Eu não tinha nada guardado sobre ${term}.`, memory: { ...memory, aliases, notes } };
  }

  const teach = raw.match(/^(?:lembr[ae](?:-se)?(?: de)? que|lembre-se que|anote(?: que)?|guarde(?: que)?|saiba que|considere)\s+(.+?)\s+(?:é|e|são|conta como|contam como|entra em|entram em|vai para|vão para|como|faz parte de)\s+(?:da categoria |a categoria |de )?(.+?)[.!?]*$/i)
    ?? raw.match(/^(.+?)\s+(?:conta como|contam como|entra em|é da categoria)\s+(.+?)[.!?]*$/i);
  if (teach) {
    const term = norm(teach[1]).replace(/^(o|a|os|as|meu|minha|meus|minhas) /, "");
    const target = teach[2].trim();
    if (!term || term.length < 2) return null;
    const category = categories.find((c) => norm(c.name) === norm(target)) ?? categories.find((c) => norm(target).includes(norm(c.name)));
    if (category) {
      return {
        text: `Anotado: quando você falar de ${term}, vou considerar a categoria ${category.name}.`,
        memory: { ...memory, aliases: { ...memory.aliases, [term]: category.id } },
        followUps: [`Quanto gastei com ${term} este mês?`],
      };
    }
    const note = `${teach[1].trim()} é ${target}`.slice(0, LIMITS.note);
    return {
      text: `Anotado: ${note}. Vou lembrar disso quando falarmos de ${teach[1].trim()}.`,
      memory: { ...memory, notes: { ...memory.notes, [term]: note } },
      followUps: [`Quanto gastei de ${teach[1].trim()} este mês?`],
    };
  }
  return null;
}

/** Counts what was asked, so the opening suggestions follow the user's own topics. */
export function rememberTopic(memory: FinnMemory, query: FinnQuery, question: string): FinnMemory {
  const key = `${query.op}|${query.type}|${query.entities.map((e) => e.term).join("+")}`;
  const current = memory.topics[key];
  return { ...memory, topics: { ...memory.topics, [key]: { n: (current?.n ?? 0) + 1, q: question.trim().slice(0, 90) } } };
}

/** The user's most asked questions (asked at least twice), most frequent first. */
export function personalSuggestions(memory: FinnMemory, max = 3): string[] {
  return Object.values(memory.topics).filter((t) => t.n >= 2).sort((a, b) => b.n - a.n).slice(0, max).map((t) => t.q);
}

export function rememberFeedback(memory: FinnMemory, op: string, rating: "up" | "down"): FinnMemory {
  const current = memory.feedback[op] ?? { up: 0, down: 0 };
  return { ...memory, feedback: { ...memory.feedback, [op]: { ...current, [rating]: current[rating] + 1 } } };
}

/** What the user said about something in the question, to repeat it back. */
export function notesFor(memory: FinnMemory, query: FinnQuery): string[] {
  return query.entities.map((e) => memory.notes[e.term]).filter((n): n is string => Boolean(n));
}
