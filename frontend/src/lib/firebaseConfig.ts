export type FirebaseEnv = Partial<Record<
  "VITE_FIREBASE_API_KEY" | "VITE_FIREBASE_AUTH_DOMAIN" | "VITE_FIREBASE_PROJECT_ID" |
  "VITE_FIREBASE_STORAGE_BUCKET" | "VITE_FIREBASE_MESSAGING_SENDER_ID" | "VITE_FIREBASE_APP_ID", string
>>;

/** Vercel values are literal: pasting a .env line instead of its value is invalid. */
export function readFirebaseConfig(env: FirebaseEnv) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY?.trim(),
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
    projectId: env.VITE_FIREBASE_PROJECT_ID?.trim(),
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
    appId: env.VITE_FIREBASE_APP_ID?.trim(),
  };
  const missing = [
    ["VITE_FIREBASE_API_KEY", config.apiKey],
    ["VITE_FIREBASE_AUTH_DOMAIN", config.authDomain],
    ["VITE_FIREBASE_PROJECT_ID", config.projectId],
    ["VITE_FIREBASE_APP_ID", config.appId],
  ].filter(([, value]) => !value).map(([key]) => key);
  const error = missing.length
    ? `Firebase não configurado neste ambiente: ${missing.join(", ")}.`
    : !/^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey!)
      ? "VITE_FIREBASE_API_KEY inválida neste ambiente. Configure somente o valor da chave Web do Firebase e gere um novo preview."
      : !/^[a-z0-9.-]+$/i.test(config.authDomain!)
        ? "VITE_FIREBASE_AUTH_DOMAIN inválido. Informe somente o domínio, sem https:// ou caminhos."
        : null;
  return { config, error };
}
