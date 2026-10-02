// Web Push enrolment. The public VAPID key comes from the API; the private key never
// leaves the backend.

import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { PushPublicKey } from "@/types/finnos";

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushAvailable(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** Must be called from a user gesture: browsers reject unsolicited permission prompts. */
export async function enablePush(): Promise<void> {
  if (!pushAvailable()) throw new Error("Este navegador não suporta avisos push.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const { public_key, supported } = await apiGet<PushPublicKey>("/push/public-key");
  if (!supported || !public_key) throw new Error("Avisos push não estão configurados no servidor.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    });
  }
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) throw new Error("Não foi possível registrar este aparelho.");
  await apiPost<void>("/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(): Promise<void> {
  if (!pushAvailable()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await apiDelete<void>(`/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`);
  await subscription.unsubscribe();
}
