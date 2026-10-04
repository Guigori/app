import { getMode } from "@/lib/mode";

export type FinnVisual = {
  title?: string;
  metrics?: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }[];
  items?: { label: string; value: string; detail?: string }[];
};
export type FinnMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; visual?: FinnVisual };
export type FinnConversation = { id: string; title: string; updatedAt: string; messages: FinnMessage[] };

const key = () => `finnos:ai-conversations:${getMode()}`;
const MAX = 3;

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
