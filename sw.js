const CACHE_NAME = "xololingua-2026-10-31-seo-1";
const ASSETS = [
  ".",
  "styles.css?v=2026-10-31-seo-1",
  "app.js?v=2026-10-31-seo-1",
  "frontend/service_url.js",
  "frontend/backend_client.js",
  "frontend/app_hybrid_router_wiring.js",
  "frontend/client_audio_extractor.js",
  "frontend/browser_audio_pcm.js",
  "frontend/browser_language_detection.js",
  "frontend/client_language_detector.js",
  "frontend/whisper_language_detector.js",
  "frontend/ffmpeg_wasm_runtime.js",
  "frontend/client_pipeline_capabilities.js",
  "frontend/browser_ml_config.js",
  "frontend/browser_resource_limits.js",
  "frontend/video_duration_policy.js",
  "frontend/browser_inference_device.js",
  "frontend/dynamic_model_resolver.js",
  "frontend/model_delivery_status.js",
  "frontend/client_pipeline_router.js",
  "frontend/browser_stage_failure.js",
  "frontend/pipeline_stage_contract.js",
  "frontend/client_srt_formatter.js",
  "frontend/client_transcriber.js",
  "frontend/client_ml_progress.js",
  "frontend/worker_request_session.js",
  "frontend/transcription_worker.js?v=2026-10-31-seo-1",
  "frontend/batched_whisper_runtime.js",
  "node_modules/@huggingface/transformers/dist/transformers.web.min.js",
  "node_modules/@huggingface/transformers/dist/transformers.min.js",
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
  "manifest.webmanifest?v=2026-10-31-seo-1",
  "assets/icon.svg?v=2026-10-31-seo-1",
  "assets/babbel_parrot.png"
];

function isCacheableDocument(response) {
  return response.status === 200 && !response.redirected &&
    /^text\/html(?:;|$)/i.test(response.headers.get("Content-Type") || "") &&
    !/\bno-store\b/i.test(response.headers.get("Cache-Control") || "");
}

// Cache storage is best-effort; its failure must not replace a network response.
async function cacheResponse(key, response) {
  try {
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(key, copy);
  } catch (_) {}
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Validate '.' separately: addAll accepts a followed redirect as a success.
      const shellKey = new URL("/", self.location.origin).href;
      const shell = await fetch(shellKey);
      if (!isCacheableDocument(shell)) throw new TypeError("Invalid app shell response");
      await cache.addAll(ASSETS.filter((asset) => asset !== "."));
      await cache.put(shellKey, shell);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("xololingua-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    const isShell = url.pathname === "/" || url.pathname === "/index.html";
    const cacheKey = isShell ? new URL("/", self.location.origin).href : url.href;
    const network = fetch(event.request);
    event.waitUntil(
      network.then((response) => {
        if (!isCacheableDocument(response)) return;
        return cacheResponse(cacheKey, response);
      }).catch(() => {})
    );
    event.respondWith(
      network.catch(async (error) => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        throw error;
      })
    );
    return;
  }
  if (url.pathname.endsWith(".js")) {
    const network = fetch(event.request);
    event.waitUntil(
      network.then((response) => cacheResponse(event.request, response)).catch(() => {})
    );
    event.respondWith(network.catch(() => caches.match(event.request)));
    return;
  }
  let cacheWrite = Promise.resolve();
  const response = caches.match(event.request).then((cached) =>
    cached || fetch(event.request).then((response) => {
      cacheWrite = cacheResponse(event.request, response);
      return response;
    })
  );
  event.waitUntil(response.then(() => cacheWrite).catch(() => {}));
  event.respondWith(response);
});
