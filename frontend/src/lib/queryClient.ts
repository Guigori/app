import { QueryClient } from "@tanstack/react-query";

// Exported so lib/session can wipe it at session boundaries — cached data outlives logout.
// Cached readers must run while offline; the data boundary enforces UID scope.
// Mutations must execute immediately so transaction writes commit to IndexedDB,
// rather than waiting in React Query's non-durable in-memory paused queue.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "offlineFirst" },
    mutations: { networkMode: "always" },
  },
});
