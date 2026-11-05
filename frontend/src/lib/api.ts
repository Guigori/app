import { firebaseAuth } from "@/lib/firebase";
import { apiBase, isNative } from "@/lib/platform";
// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → the Firestore API on :8002) and behind a single origin in prod.
const BASE = apiBase();

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

// Web: a sessão vai no cookie httpOnly. App nativo (capacitor://localhost) não tem cookie de
// mesma origem, então envia o ID token do Firebase (renovado pelo SDK) como Bearer.
async function nativeAuthHeader(): Promise<Record<string, string>> {
  if (!isNative() || !firebaseAuth?.currentUser) return {};
  return { Authorization: `Bearer ${await firebaseAuth.currentUser.getIdToken()}` };
}

async function request<T>(method: string, path: string, body?: JsonBody, extraHeaders?: Record<string, string>): Promise<T> {
  const requestUid = firebaseAuth?.currentUser?.uid;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: isNative() ? "omit" : "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders, ...(await nativeAuthHeader()), ...(firebaseAuth?.currentUser ? { "X-FINNOS-User-ID": firebaseAuth.currentUser.uid } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (requestUid !== firebaseAuth?.currentUser?.uid) throw new Error("FINNOS_SESSION_CHANGED");

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody, headers?: Record<string, string>) => request<T>("POST", path, body ?? null, headers);
export const apiPut = <T>(path: string, body?: JsonBody, headers?: Record<string, string>) => request<T>("PUT", path, body ?? null, headers);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string, headers?: Record<string, string>) => request<T>("DELETE", path, undefined, headers);

export async function apiPostWithBearer<T>(path: string, token: string, body?: JsonBody): Promise<T> {
  // App nativo: não há cookie de sessão. O login só confirma o token no servidor (GET /auth/me)
  // e as chamadas seguintes levam o Bearer (ver nativeAuthHeader).
  if (isNative() && path === "/auth/firebase-session") {
    const check = await fetch(`${BASE}/auth/me`, { method: "GET", credentials: "omit", headers: { Authorization: `Bearer ${token}` } });
    if (!check.ok) throw new ApiError(check.status, await check.json().catch(() => null));
    return (await check.json()) as T;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
