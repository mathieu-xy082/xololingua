import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const appHybridRouterWiringSource = await readFile(
  new URL("../frontend/app_hybrid_router_wiring.js", import.meta.url),
  "utf8",
);
const clientPipelineRouterSource = await readFile(
  new URL("../frontend/client_pipeline_router.js", import.meta.url),
  "utf8",
);
const ffmpegWasmRuntimeSource = await readFile(
  new URL("../frontend/ffmpeg_wasm_runtime.js", import.meta.url),
  "utf8",
);
const clientPipelineCapabilitiesSource = await readFile(
  new URL("../frontend/client_pipeline_capabilities.js", import.meta.url),
  "utf8",
);

test("service worker precaches JavaScript modules imported by the PWA shell and app wiring", () => {
  const importedModules = [
    ...appSource.matchAll(/import\s+[^;]+from\s+["']\.\/(frontend\/[^"']+)["']/g),
    ...appHybridRouterWiringSource.matchAll(/import\s+[^;]+from\s+["']\.\/(client_pipeline_router\.js)["']/g),
    ...clientPipelineRouterSource.matchAll(/import\s+[^;]+from\s+["']\.\/(pipeline_stage_contract\.js)["']/g),
  ]
    .map((match) => match[1].startsWith("frontend/") ? match[1] : `frontend/${match[1]}`)
    .sort();
  const cachedAssets = [...serviceWorkerSource.matchAll(/["'](frontend\/[^"']+\.js)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    importedModules.filter((modulePath) => !cachedAssets.includes(modulePath)),
    [],
  );
});

test("service worker precaches the full frontend module graph used by offline assets", () => {
  const importedModules = new Set([
    ...appSource.matchAll(/import\s+[^;]+from\s+["']\.\/(frontend\/[^"']+)["']/g),
    ...appHybridRouterWiringSource.matchAll(/import\s+[^;]+from\s+["']\.\/(client_pipeline_router\.js)["']/g),
    ...clientPipelineRouterSource.matchAll(/import\s+[^;]+from\s+["']\.\/(pipeline_stage_contract\.js)["']/g),
    ...clientPipelineCapabilitiesSource.matchAll(/import\s+[^;]+from\s+["']\.\/((?:client_|model_asset_)[^"']+\.js)["']/g),
  ]
    .map((match) => match[1].startsWith("frontend/") ? match[1] : `frontend/${match[1]}`));
  const cachedAssets = new Set(
    [...serviceWorkerSource.matchAll(/["'](frontend\/[^"']+\.js)["']/g)]
      .map((match) => match[1]),
  );

  assert.deepEqual([...cachedAssets].sort(), [...importedModules].sort());
});

test("PWA shell starts from the hybrid pipeline router wiring contract", () => {
  assert.match(
    appSource,
    /import\s+\{\s*collectClientPipelineCapabilities\s*\}\s+from\s+["']\.\/frontend\/client_pipeline_capabilities\.js["']/,
  );
  assert.match(
    appSource,
    /import\s+\{[^}]*createAppHybridPipelineRouter[^}]*\}\s+from\s+["']\.\/frontend\/app_hybrid_router_wiring\.js["']/,
  );
  assert.match(appSource, /createAppClientAdapters\(\{\s*clientAudioExtractor:/s);
  assert.match(
    appHybridRouterWiringSource,
    /import\s+\{\s*createHybridPipelineRouter\s*\}\s+from\s+["']\.\/client_pipeline_router\.js["']/,
  );
});

test("PWA shell precaches the browser model asset manifest resolver", () => {
  assert.match(clientPipelineCapabilitiesSource, /\.\/model_asset_manifest\.js/);
  assert.match(serviceWorkerSource, /frontend\/model_asset_manifest\.js/);
});

test("PWA shell loads ffmpeg wasm browser assets before the module app starts", () => {
  assert.match(indexSource, /node_modules\/@ffmpeg\/ffmpeg\/dist\/ffmpeg\.min\.js/);
  assert.match(ffmpegWasmRuntimeSource, /node_modules\/@ffmpeg\/core\/dist\/ffmpeg-core\.js/);
});

test("PWA shell loads vad-web and ONNX Runtime browser assets before the module app starts", () => {
  assert.match(indexSource, /node_modules\/onnxruntime-web\/dist\/ort\.min\.js/);
  assert.match(indexSource, /node_modules\/@ricky0123\/vad-web\/dist\/bundle\.min\.js/);
  assert.match(serviceWorkerSource, /node_modules\/onnxruntime-web\/dist\/ort-wasm-simd\.wasm/);
  assert.match(serviceWorkerSource, /node_modules\/@ricky0123\/vad-web\/dist\/silero_vad_legacy\.onnx/);
});

test("PWA shell reads service metadata through the backend client boundary", () => {
  assert.match(appSource, /backendClient\.getHealth\(\)/);
  assert.match(appSource, /backendClient\.getTranslationPairs\(\)/);
  assert.doesNotMatch(appSource, /fetch\(`\$\{LOCAL_SERVICE_URL\}\/api\/(?:health|translation-pairs)`\)/);
});

test("PWA shell displays honest offline asset and Python fallback metadata", () => {
  assert.match(indexSource, /id=["']pwaOfflineScope["']/);
  assert.match(indexSource, /id=["']pipelineBrowserStages["']/);
  assert.match(indexSource, /id=["']pipelineFallbackStages["']/);
  assert.match(indexSource, /id=["']pipelineFallbackEndpoints["']/);
  assert.match(appSource, /clientPipelineCapabilities\.demoSummary/);
  assert.match(appSource, /summary\.offlineScopeLabel/);
  assert.match(appSource, /serverFallbackEndpoints/);
  assert.match(appSource, /Offline assets available; ML stages may still need Python fallback/);
});

test("PWA asset cache version changes with the app shell version", () => {
  const [, appAssetVersion] = appSource.match(/APP_ASSET_VERSION\s*=\s*["']([^"']+)["']/) || [];
  const [, cacheName] = serviceWorkerSource.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/) || [];

  assert.ok(appAssetVersion);
  assert.equal(cacheName, `xololingua-${appAssetVersion}`);
  assert.match(indexSource, new RegExp(`app\\.js\\?v=${appAssetVersion}`));
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${appAssetVersion}`));
  assert.match(serviceWorkerSource, new RegExp(`app\\.js\\?v=${appAssetVersion}`));
  assert.match(serviceWorkerSource, new RegExp(`styles\\.css\\?v=${appAssetVersion}`));
});
