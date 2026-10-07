// Session boundary helpers. The session itself is an httpOnly cookie the backend sets —
// this module only makes sure the react-query cache never leaks across sessions.
import { apiPost } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { clearAccountCache } from "@/lib/offline/accountCache";

/** After login/signup: drop stale cache so the app fetches the new session's data. */
export async function beginSession(): Promise<void> {
  queryClient.clear();
  await clearAccountCache();
}

/** Every sign-out control must go through here — clearing only the server session
 *  would leak the previous account's cached data into the next login. */
export async function endSession(): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } finally {
    queryClient.clear();
    await clearAccountCache();
  }
}
