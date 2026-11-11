import type { Chart as CatalogChart } from "@/lib/insights/catalog";
import type { FinnQuery } from "@/lib/finnQuestion";
import type { Proposal, ProposalState } from "@/lib/finnActions";
import { firebaseAuth } from "@/lib/firebase";
import { getMode } from "@/lib/mode";

export type FinnVisual = {
  title?: string;
  metrics?: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }[];
  items?: { label: string; value: string; detail?: string }[];
  /** A chart of the analysis library (Gráficos FINNOS), drawn exactly like the widget. */
  finnos?: CatalogChart;
  chart?: { type: "line" | "donut" | "bar" | "hbar"; data: { name: string; value: number; secondary?: number }[]; valueLabel?: string; secondaryLabel?: string; /** Sign before each bar value ("+" by default). */ prefix?: string };
};
export type FinnMessage = {
  id: string; role: "user" | "assistant"; content: string; createdAt: string; visual?: FinnVisual;
  /** Analyst answers: what it noticed, the next questions, where to look, and what it understood. */
  insight?: string; followUps?: string[]; links?: { label: string; to: string }[]; query?: FinnQuery;
  /** "✓ …" lines, and a change the user reviews before anything is saved. */
  steps?: string[]; proposal?: Proposal; proposalState?: ProposalState;
  /** The analysis being talked about (follow-ups keep the subject). */
  topic?: string;
};
export type FinnConversation = { id: string; title: string; updatedAt: string; messages: FinnMessage[] };

const key = () => `finnos:ai-conversations:${getMode()}:${getMode() === "account" ? firebaseAuth?.currentUser?.uid ?? "unauthenticated" : "device"}`;
const MAX = 30;

export function readFinnConversations(): FinnConversation[] {
  try { return JSON.parse(localStorage.getItem(key()) ?? "[]") as FinnConversation[]; } catch { return []; }
}
export function saveFinnConversations(items: FinnConversation[]) {
  localStorage.setItem(key(), JSON.stringify(items.slice(0, MAX)));
}
export function newFinnConversation(): FinnConversation {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: "Nova conversa", updatedAt: now, messages: [] };
}
export function upsertFinnConversation(conversation: FinnConversation) {
  const items = readFinnConversations().filter((x) => x.id !== conversation.id);
  saveFinnConversations([{ ...conversation, updatedAt: new Date().toISOString() }, ...items]);
}
export function clearFinnConversations() { localStorage.removeItem(key()); }
export function deleteFinnConversation(id: string) { saveFinnConversations(readFinnConversations().filter((x) => x.id !== id)); }

/** History groups: Hoje, Ontem, Últimos 7 dias, Este mês, Mais antigas. */
export function conversationGroup(iso: string, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 7) return "Últimos 7 dias";
  if (diff < 31) return "Últimos 30 dias";
  return "Mais antigas";
}
