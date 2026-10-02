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
