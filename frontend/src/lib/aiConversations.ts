import type { FinnQuery } from "@/lib/finnQuestion";
import type { Proposal, ProposalState } from "@/lib/finnActions";
import { firebaseAuth } from "@/lib/firebase";
import { getMode } from "@/lib/mode";

export type FinnVisual = {
  title?: string;
  metrics?: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }[];
  items?: { label: string; value: string; detail?: string }[];
  chart?: { type: "line" | "donut" | "bar" | "hbar"; data: { name: string; value: number; secondary?: number }[]; valueLabel?: string; secondaryLabel?: string; /** Sign before each bar value ("+" by default). */ prefix?: string };
};
export type FinnMessage = {
  id: string; role: "user" | "assistant"; content: string; createdAt: string; visual?: FinnVisual;
  /** Analyst answers: what it noticed, the next questions, where to look, and what it understood. */
  insight?: string; followUps?: string[]; links?: { label: string; to: string }[]; query?: FinnQuery;
  /** "✓ …" lines, and a change the user reviews before anything is saved. */
  steps?: string[]; proposal?: Proposal; proposalState?: ProposalState;
};
export type FinnConversation = { id: string; title: string; updatedAt: string; messages: FinnMessage[] };

const key = () => `finnos:ai-conversations:${getMode()}:${getMode() === "account" ? firebaseAuth?.currentUser?.uid ?? "unauthenticated" : "device"}`;
const MAX = 10;

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
