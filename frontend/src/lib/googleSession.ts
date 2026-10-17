import { getAdditionalUserInfo, signInWithPopup, signOut } from "firebase/auth";
import { firebaseAuth, firebaseConfigurationError, googleProvider } from "./firebase";
import { apiPostWithBearer } from "./api";
import { getApiErrorMessage } from "./errors";
import type { User } from "@/types/finnos";

export async function openGoogleSession(onNewAccount?: () => Promise<unknown>): Promise<User> {
  if (!firebaseAuth) throw new Error(firebaseConfigurationError || "Firebase não configurado neste ambiente.");
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  try {
    const idToken = await result.user.getIdToken();
    const user = await apiPostWithBearer<User>("/auth/firebase-session", idToken);
    // New Google accounts can initialize their wizard after server authentication.
    // Onboarding service failures must not invalidate a valid Firebase session.
    if (onNewAccount && getAdditionalUserInfo(result)?.isNewUser) {
      await onNewAccount().catch(() => undefined);
    }
    return user;
  } catch (error) {
    // A successful popup is not a successful FINNOS server session.
    await signOut(firebaseAuth).catch(() => undefined);
    throw error;
  }
}

export function googleSessionError(error: unknown): string {
  if (!firebaseAuth) return firebaseConfigurationError || "Firebase não configurado neste ambiente.";
  const code = typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && error.code.startsWith("auth/") ? error.code : null;
  if (code === "auth/api-key-not-valid" || code === "auth/invalid-api-key") {
    return `A chave Firebase deste ambiente foi recusada (${code}). Confira a chave Web, o projeto e as restrições da API no Preview e gere um novo deploy.`;
  }
  if (code === "auth/unauthorized-domain") {
    return "Este domínio de preview não está autorizado no Firebase (auth/unauthorized-domain).";
  }
  return code ? `Falha na autenticação Google (${code}).`
    : getApiErrorMessage(error, "Não foi possível iniciar a sessão no servidor.");
}
