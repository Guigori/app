import { firebaseAuth } from "./firebase";
import { apiGet, ApiError } from "./api";
import { disableLocalMode, isLocalMode } from "./mode";
import { cachedFetch } from "./offline/accountCache";
import type { User } from "@/types/finnos";

/** Resolve identity before the protected layout can read any financial source. */
export async function loadSessionProfile(localProfile: () => User): Promise<User> {
  await firebaseAuth?.authStateReady();
  const uid = firebaseAuth?.currentUser?.uid;
  const accountProfile = async () => {
    const user = await apiGet<User>("/auth/me");
    if (uid && user.id !== uid) throw new Error("FINNOS_SESSION_CHANGED");
    if (uid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");
    return { ...user, session_mode: "account" as const };
  };
  if (isLocalMode()) {
    if (!navigator.onLine && !uid) return localProfile();
    try {
      const user = await accountProfile();
      disableLocalMode();
      return user;
    } catch (error) {
      // Only a confirmed missing session permits the explicitly selected local
      // identity. Server failures and Firebase identities never become demos.
      if (error instanceof ApiError && error.status === 401 && !uid) return localProfile();
      throw error;
    }
  }
  const user = await cachedFetch("me", accountProfile);
  if (uid && user.id !== uid) throw new Error("FINNOS_SESSION_CHANGED");
  disableLocalMode();
  return { ...user, session_mode: "account" };
}

export function authenticationLabel(user: User | undefined): string {
  if (!user) return "Carregando identidade…";
  if (user.session_mode === "local") return "Modo local — neste aparelho";
  if (user.session_mode === "demo") return "Demonstração local — neste aparelho";
  const provider = user.auth_provider;
  return provider === "google.com" ? "Firebase Authentication · Google"
    : provider === "password" ? "Firebase Authentication · E-mail e senha"
    : "Firebase Authentication";
}
