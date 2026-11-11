/** `lazy` that survives a deploy: a page chunk that is gone (a new version was published while the app
 *  was open) reloads the app once, by itself, instead of leaving a white screen. */
import { lazy, type ComponentType } from "react";

const RELOADED = "finnos:chunk-reloaded";

export const isChunkError = (error: unknown) =>
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|Loading chunk|ChunkLoadError|error loading dynamically imported/i.test(String((error as Error)?.message ?? error));

/** Reloads once per session when a page chunk is gone; then lets the boundary explain. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED)) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch { return false; }
  window.location.reload();
  return true;
}

// oxlint-disable-next-line typescript/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(RELOADED); } catch { /* private mode */ }
      return mod;
    } catch (error) {
      if (isChunkError(error) && reloadOnce()) return new Promise<{ default: T }>(() => undefined);
      throw error;
    }
  });
}
