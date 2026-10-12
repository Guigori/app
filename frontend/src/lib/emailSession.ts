import { createUserWithEmailAndPassword, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from "firebase/auth";
import { firebaseAuth, firebaseConfigurationError } from "./firebase";
import { apiPostWithBearer } from "./api";
import { getApiErrorMessage } from "./errors";
import type { User } from "@/types/finnos";

function configuredAuth() {
  if (!firebaseAuth) throw new Error(firebaseConfigurationError || "Firebase não configurado neste ambiente.");
  return firebaseAuth;
}

export async function openEmailSession(email: string, password: string): Promise<User> {
  const auth = configuredAuth();
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    if (!result.user.emailVerified) throw Object.assign(new Error("Confirme seu e-mail antes de entrar."), { code: "finnos/email-unverified" });
    return await apiPostWithBearer<User>("/auth/firebase-session", await result.user.getIdToken());
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function createEmailAccount(name: string, email: string, password: string) {
  const result = await createUserWithEmailAndPassword(configuredAuth(), email.trim(), password);
  try {
    await updateProfile(result.user, { displayName: name.trim() });
    await sendEmailVerification(result.user);
    return { uid: result.user.uid, verificationSent: true };
  } catch {
    // Account creation succeeded: do not encourage creation of a second identity.
    return { uid: result.user.uid, verificationSent: false };
  }
}

export async function resendAccountVerification(uid: string) {
  const user = configuredAuth().currentUser;
  if (!user || user.uid !== uid) throw new Error("Entre novamente para confirmar esta conta.");
  await sendEmailVerification(user);
}

export async function completeEmailVerification(uid: string): Promise<User> {
  const auth = configuredAuth();
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error("Entre novamente para confirmar esta conta.");
  await reload(user);
  if (!user.emailVerified) throw new Error("Abra o link recebido por e-mail antes de continuar.");
  try {
    return await apiPostWithBearer<User>("/auth/firebase-session", await user.getIdToken(true));
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function requestPasswordRecovery(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(configuredAuth(), email.trim());
  } catch (error) {
    // Avoid disclosing account existence, including in older Firebase projects.
    if (typeof error === "object" && error && "code" in error && error.code === "auth/user-not-found") return;
    throw error;
  }
}

export function emailSessionError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? error.code : null;
  if (code === "finnos/email-unverified") return "Confirme seu e-mail antes de entrar.";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(String(code))) return "E-mail ou senha incorretos.";
  if (code === "auth/too-many-requests") return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  if (code === "auth/network-request-failed") return "Sem conexão com o Firebase. Verifique sua internet.";
  if (code === "auth/operation-not-allowed") return "Login por e-mail e senha não está habilitado neste projeto Firebase.";
  if (code === "auth/email-already-in-use") return "Este e-mail já está cadastrado. Entre ou recupere sua senha.";
  if (code === "auth/weak-password") return "Escolha uma senha mais forte.";
  if (code === "auth/invalid-email") return "Confira o endereço de e-mail.";
  if (code === "auth/api-key-not-valid" || code === "auth/invalid-api-key") return "A configuração Firebase deste ambiente foi recusada.";
  return getApiErrorMessage(error, error instanceof Error && !code ? error.message : "Não foi possível autenticar. Tente novamente.");
}
