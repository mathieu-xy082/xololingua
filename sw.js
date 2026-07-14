const CACHE_NAME = "xololingua-v9";
const ASSETS = [
  ".",
  "styles.css?v=2026-05-17-3",
  "app.js?v=2026-05-17-3",
  "frontend/backend_client.js",
  "frontend/app_hybrid_router_wiring.js",
  "frontend/client_pipeline_capabilities.js",
  "frontend/client_pipeline_router.js",
  "frontend/client_srt_formatter.js",
  "frontend/pipeline_stage_status.js",
  "manifest.webmanifest?v=2026-05-17-3",
  "assets/icon.svg?v=2026-05-17-3",
  "assets/babbel_parrot.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("index.html", copy));
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("index.html")))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
    )
  );
});
