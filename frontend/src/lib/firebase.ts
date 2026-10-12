import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
