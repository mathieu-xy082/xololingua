const CACHE_NAME = "xololingua-2026-07-15-1";
const MODEL_ASSET_CACHE_NAME = "xololingua-model-assets-browser-model-assets-v1";
const MODEL_ASSET_BOOTSTRAP_URLS = [
  "models/asr/whisper-base/manifest.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/added_tokens.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/generation_config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/merges.txt?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/normalizer.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/onnx/decoder_model_merged_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/onnx/decoder_model_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/onnx/decoder_with_past_model_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/onnx/encoder_model_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/preprocessor_config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/quant_config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/quantize_config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/special_tokens_map.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/tokenizer.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/tokenizer_config.json?v=browser-model-assets-v1",
  "models/Xenova/whisper-base/vocab.json?v=browser-model-assets-v1",
  "models/translation/opus-mt-fr-en/manifest.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/config.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/generation_config.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/onnx/decoder_model_merged_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/onnx/encoder_model_q4.onnx?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/quantize_config.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/source.spm?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/special_tokens_map.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/target.spm?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/tokenizer.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/tokenizer_config.json?v=browser-model-assets-v1",
  "models/Xenova/opus-mt-fr-en/vocab.json?v=browser-model-assets-v1"
];
const ASSETS = [
  ".",
  "styles.css?v=2026-07-15-1",
  "app.js?v=2026-07-15-1",
  "frontend/backend_client.js",
  "frontend/app_hybrid_router_wiring.js",
  "frontend/client_audio_extractor.js",
  "frontend/ffmpeg_wasm_runtime.js",
  "frontend/client_pipeline_capabilities.js",
  "frontend/model_asset_bootstrap.js",
  "frontend/model_asset_manifest.js",
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
  "frontend/pipeline_stage_status.js",
  "node_modules/onnxruntime-web/dist/ort.min.js",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm.wasm",
  "node_modules/@ricky0123/vad-web/dist/bundle.min.js",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
  "manifest.webmanifest?v=2026-07-15-1",
  "assets/icon.svg?v=2026-07-15-1",
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

self.addEventListener("message", (event) => {
  if (event.data?.type !== "BOOTSTRAP_MODEL_ASSETS") return;
  event.waitUntil(
    bootstrapModelAssetCache(event.source)
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.includes("/models/") && isTrackedModelAssetRequest(url)) {
    event.respondWith(cacheModelAssetRequest(event.request));
    return;
  }
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

function isTrackedModelAssetRequest(url) {
  const relativeUrl = `${url.pathname.replace(/^\//, "")}${url.search}`;
  return MODEL_ASSET_BOOTSTRAP_URLS.includes(relativeUrl);
}

function bootstrapModelAssetCache(client) {
  const results = [];
  return MODEL_ASSET_BOOTSTRAP_URLS.reduce((promise, url) => promise.then(() =>
    cacheModelAssetRequest(new Request(url)).then((response) => {
      const ok = response.ok;
      results.push({ url, ok, status: response.status, retryable: !ok });
      client?.postMessage?.({ type: "MODEL_ASSET_BOOTSTRAP_PROGRESS", url, ok, status: response.status, retryable: !ok });
    })
  ), Promise.resolve()).then(() => {
    const failed = results.filter((result) => !result.ok);
    client?.postMessage?.({
      type: "MODEL_ASSET_BOOTSTRAP_COMPLETE",
      status: failed.length === 0 ? "offline-ready" : "bootstrap-required",
      retryable: failed.length > 0,
      results,
    });
  });
}

function cacheModelAssetRequest(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (!response.ok) {
      return response;
    }
    const copy = response.clone();
    caches.open(MODEL_ASSET_CACHE_NAME).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => new Response(JSON.stringify({
    error: "Browser model asset is not cached and network bootstrap failed.",
    fallback: "server-fallback",
  }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  })));
}
