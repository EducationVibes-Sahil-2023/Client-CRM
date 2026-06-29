// Desktop notifications via the browser Notifications API. Free, no push service
// or service worker required — these fire while the app is open in a browser tab
// (including when that tab is backgrounded or another app is focused). True push
// while the browser is fully closed would need a service worker + VAPID backend.

let lastFiredAt = 0;

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Ask for notification permission once (no-op if already decided). */
export async function requestNotifyPermission(): Promise<void> {
  if (!notifySupported()) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* user dismissed / unsupported */
  }
}

/**
 * Show a chat desktop notification. Debounced (1.5s) so the two independent
 * pollers — ChatView and ChatLauncher — never double-fire for the same event.
 * Clicking the notification focuses the app window.
 */
export function notifyMessage(title: string, body: string): void {
  if (!notifySupported() || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastFiredAt < 1500) return;
  lastFiredAt = now;
  try {
    // No `tag`: a repeated tag makes the browser replace the previous alert
    // silently (no banner/sound). Each message gets its own fresh notification.
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
