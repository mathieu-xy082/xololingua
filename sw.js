const CACHE_NAME = "xololingua-2026-08-15-7";
const ASSETS = [
  ".",
  "styles.css?v=2026-08-15-7",
  "app.js?v=2026-08-15-7",
  "frontend/backend_client.js",
  "frontend/app_hybrid_router_wiring.js",
  "frontend/client_audio_extractor.js",
  "frontend/ffmpeg_wasm_runtime.js",
  "frontend/client_pipeline_capabilities.js",
  "frontend/browser_ml_config.js",
  "frontend/dynamic_model_resolver.js",
  "frontend/model_delivery_status.js",
  "frontend/client_pipeline_router.js",
  "frontend/pipeline_stage_contract.js",
  "frontend/client_srt_formatter.js",
  "frontend/client_transcriber.js",
  "frontend/transcription_worker.js",
  "node_modules/@huggingface/transformers/dist/transformers.web.min.js",
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
  "frontend/client_translator.js",
  "frontend/translation_worker.js",
  "frontend/client_vad_segmenter.js",
  "frontend/vad_web_runtime.js",
  "frontend/vad_worker.js",
  "frontend/pipeline_stage_status.js",
  "node_modules/onnxruntime-web/dist/ort.min.js",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm.wasm",
  "node_modules/@ricky0123/vad-web/dist/bundle.min.js",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
  "manifest.webmanifest?v=2026-08-15-7",
  "assets/icon.svg?v=2026-08-15-7",
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
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
