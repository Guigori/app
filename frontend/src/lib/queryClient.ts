import { QueryClient } from "@tanstack/react-query";

// Exported so lib/session can wipe it at session boundaries — cached data outlives logout.
// Cached readers must run while offline; the data boundary enforces UID scope.
// Mutations must execute immediately so transaction writes commit to IndexedDB,
// rather than waiting in React Query's non-durable in-memory paused queue.
export const queryClient = new QueryClient({
  defaultOptions: {
    // Data stays fresh for 2 minutes and is not fetched again just because the window got focus: every
    // read costs a Firestore read on the server. Saving anything invalidates the affected queries, so edits
    // still show at once.
    queries: { networkMode: "offlineFirst", staleTime: 120_000, refetchOnWindowFocus: false },
    mutations: { networkMode: "always" },
  },
});
