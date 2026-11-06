import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, indexedDBLocalPersistence, initializeAuth, type Auth } from "firebase/auth";
import { isNative } from "./platform";
import { readFirebaseConfig } from "./firebaseConfig";

const { config, error } = readFirebaseConfig({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
});
export const firebaseConfigurationError = error;

export const firebaseConfigured = error === null;

export const firebaseApp = firebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(config))
  : null;

// No app nativo (WKWebView em capacitor://localhost) o getAuth() padrão carrega um iframe de
// popup/redirect no authDomain e pode nunca terminar de iniciar, deixando authStateReady()
// pendente. Lá iniciamos só com a persistência local, sem o resolvedor de popup: o login por
// e-mail e senha não precisa dele (o Google nativo entra em outra etapa).
function createAuth(app: NonNullable<typeof firebaseApp>): Auth {
  if (!isNative()) return getAuth(app);
  try {
    return initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch {
    // Já inicializado (recarga em desenvolvimento): reaproveita a instância existente.
    return getAuth(app);
  }
}

export const firebaseAuth = firebaseApp ? createAuth(firebaseApp) : null;
// The browser never talks to Firestore directly: every read and write goes through the
// FastAPI server (Admin SDK). Not loading the client SDK keeps ~1 MB out of the app.

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
