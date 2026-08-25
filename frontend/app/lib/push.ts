// Web Push (browser) notifications for the client dashboard.
//
// Registers the service worker (public/sw.js), asks for notification permission
// and subscribes the browser to push, then stores the subscription server-side.
// Gated by the per-client `web_push` feature: the public-key endpoint reports
// whether push is enabled, so a disabled client never subscribes.

import { getPushPublicKey, savePushSubscription, deletePushSubscription, sendTestPush, type PushTestResult } from "./client";

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

  const appKey = urlBase64ToUint8Array(info.key);
  let sub = await reg.pushManager.getSubscription();
  // If an existing subscription was made with a DIFFERENT VAPID key (e.g. the
  // server rotated keys), the push service rejects it (401/403) forever — drop it
  // and re-subscribe with the current key instead of silently reusing a dead one.
  if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey as BufferSource,
    });
  }

  const json = sub.toJSON();
  await savePushSubscription({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  }).catch(() => {});
}

/** Whether an existing subscription's server key matches the current VAPID key. */
function sameKey(existing: ArrayBuffer | null, want: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== want.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== want[i]) return false;
  return true;
}

/**
 * Ensure this browser is subscribed, then ask the server to send a test push +
 * in-app notification. Returns the server's diagnostic so the UI can explain the
 * result (feature off, no keys, not subscribed, or delivered).
 */
export async function testWebPush(): Promise<PushTestResult> {
  await subscribeToPush().catch(() => {});
  return sendTestPush();
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
