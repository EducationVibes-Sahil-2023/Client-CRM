/* Web Push service worker for the CRM client dashboard.
 *
 * Receives push messages (even when no tab is open) and shows an OS
 * notification; clicking it focuses an existing window or opens the deep link.
 * Payload shape (set by the backend PushService): { title, body, url }.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Notification", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Notification";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/" },
    // Collapse duplicate alerts for the same target.
    tag: data.url || undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an open tab on the same origin (and navigate it) if we can.
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && url !== "/") client.navigate(url).catch(() => {});
          return undefined;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
