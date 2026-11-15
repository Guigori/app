/**
 * Live updates: instead of asking the server again and again whether anything changed, the app listens to ONE
 * document in Firestore, `users/{uid}/_meta/finance`, whose `revision` the server raises on every write of the
 * person's data. Nothing changes → no reads at all; something changes (on this device or another) → one read,
 * and the app refreshes what is on screen. While it listens, data stays fresh in memory much longer, so changing
 * screens does not ask the server again.
 *
 * The listener needs a Firestore rule letting each signed-in person read only that one document of their own.
 * Without the rule (or offline, or in local mode) it stays off and the app keeps the timed refreshes.
 */
import { useSyncExternalStore } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseApp, firebaseAuth } from "@/lib/firebase";
import { isLocalMode } from "@/lib/mode";
import { queryClient } from "@/lib/queryClient";

/** How long data stays fresh: with the listener it only expires as a safety net (dates still move daily). */
export const STALE_LISTENING = 30 * 60_000;
export const STALE_POLLING = 120_000;

let live = false;
const subscribers = new Set<() => void>();
const setLive = (next: boolean) => {
  if (live === next) return;
  live = next;
  const queries = queryClient.getDefaultOptions().queries ?? {};
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queries, staleTime: next ? STALE_LISTENING : STALE_POLLING } });
  subscribers.forEach((cb) => cb());
};

/** True while the app is listening: timed refreshes (the bell, the menu) can stand down. */
export function useLiveUpdates(): boolean {
  return useSyncExternalStore(
    (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); },
    () => live,
    () => false,
  );
}

/** What a revision change does: everything cached is stale, what is on screen is fetched again. */
export function onRevision(previous: number | null, next: number): number {
  if (previous !== null && next !== previous) void queryClient.invalidateQueries();
  return next;
}

let stopListening: (() => void) | null = null;

async function listen(user: User) {
  stopListening?.();
  stopListening = null;
  if (!firebaseApp) return;
  // The Firestore client is only loaded for signed-in people, after the app is up (it is a large module).
  const { getFirestore, doc, onSnapshot } = await import("firebase/firestore");
  let last: number | null = null;
  const unsubscribe = onSnapshot(
    doc(getFirestore(firebaseApp), "users", user.uid, "_meta", "finance"),
    { includeMetadataChanges: false },
    (snap) => {
      const revision = Number((snap.data() as { revision?: number } | undefined)?.revision ?? 0);
      last = onRevision(last, revision);
      setLive(true);
    },
    () => {
      // No rule yet, offline for good, or signed out: back to the timed refreshes.
      setLive(false);
    },
  );
  stopListening = () => { unsubscribe(); setLive(false); };
}

/** Starts with the session and follows sign-in and sign-out. Returns the cleanup. */
export function startLiveUpdates(): () => void {
  if (!firebaseAuth || isLocalMode()) return () => undefined;
  const off = onAuthStateChanged(firebaseAuth, (user) => {
    if (user) void listen(user).catch(() => setLive(false));
    else {
      stopListening?.();
      stopListening = null;
      // The device copy of the account (lib/mirror.ts) never outlives the session.
      void import("@/lib/mirror").then((m) => m.clearMirror()).catch(() => undefined);
    }
  });
  return () => { off(); stopListening?.(); stopListening = null; };
}
