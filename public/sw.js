// JEE Study App service worker — local-first offline shell.
// Strategy: network-first for everything (fresh code always wins), with the
// cache as an offline fallback ("/" for navigations). Precache keeps the shell
// + demo paper available offline. Never touches /api/*, cross-origin, non-GET.
// NOTE: cache-first was rejected — dev chunks change under the same URL and a
// cache-first SW served stale code during verification.
const CACHE = "jee-study-v2";
const PRECACHE = ["/", "/demo-paper.pdf", "/manifest.webmanifest", "/logo.svg", "/pdf.worker.min.mjs"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // network-first with cache fallback — fresh code always wins
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))
      )
  );
});
