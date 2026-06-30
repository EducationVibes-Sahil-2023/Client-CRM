// Web Push (browser) notifications for the client dashboard.
//
// Registers the service worker (public/sw.js), asks for notification permission
// and subscribes the browser to push, then stores the subscription server-side.
// Gated by the per-client `web_push` feature: the public-key endpoint reports
// whether push is enabled, so a disabled client never subscribes.

import { getPushPublicKey, savePushSubscription, deletePushSubscription } from "./client";

/** Decode a base64url VAPID key into the Uint8Array the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether this browser can do web push (and we're in a secure context). */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    (window.isSecureContext || location.hostname === "localhost")
  );
}

/**
 * Register the SW, request permission and subscribe — then persist the
 * subscription. Idempotent: reuses an existing browser subscription. Silently
 * no-ops when push is unsupported, denied, or disabled for the client.
 */
export async function subscribeToPush(): Promise<void> {
  if (!pushSupported() || Notification.permission === "denied") return;

  // Ask the server for the VAPID key + whether the feature is on for this client.
  let info: { key: string; enabled: boolean };
  try {
    info = await getPushPublicKey();
  } catch {
    return;
  }
  if (!info.enabled || !info.key) return;

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.key) as BufferSource,
    });
  }

  const json = sub.toJSON();
  await savePushSubscription({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  }).catch(() => {});
}

/** Unsubscribe this browser and forget the subscription server-side. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await deletePushSubscription(endpoint).catch(() => {});
}
