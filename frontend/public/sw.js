// FINNOS service worker — intentionally a passthrough: registering a fetch handler makes
// the app installable as a PWA without serving stale caches in the first delivery.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // network passthrough — offline shell caching arrives with a later delivery
});

// --- Web Push: show the reminder, and focus/open the app when it is tapped ---
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "FINNOS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/brand/finnos-icon.png",
      badge: "/brand/finnos-icon.png",
      tag: data.tag || "finnos",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
