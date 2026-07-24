import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_MODEL_ASSET_MANIFEST,
  buildModelAssetCacheUrls,
} from "../frontend/model_asset_manifest.js";
import {
  inspectBrowserModelAssetCache,
  resolveBrowserModelAssetBootstrap,
} from "../frontend/model_asset_bootstrap.js";

function createCacheEnvironment(cachedUrls = [], { cacheOpenError } = {}) {
  const cached = new Set(cachedUrls);
  const openedCaches = [];
  return {
    openedCaches,
    caches: {
      async open(cacheName) {
        openedCaches.push(cacheName);
        if (cacheOpenError) {
          throw cacheOpenError;
        }
        return {
          async match(url) {
            return cached.has(url) ? { ok: true, url } : undefined;
          },
        };
      },
    },
    indexedDB: {},
  };
}

test("inspectBrowserModelAssetCache reads the real Cache API and reports cached versioned URLs", async () => {
  const cachedUrl = "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1";
  const environment = createCacheEnvironment([cachedUrl]);

  const result = await inspectBrowserModelAssetCache({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.deepEqual(environment.openedCaches, ["xololingua-model-assets-browser-model-assets-v1"]);
  assert.deepEqual(result, {
    available: true,
    cacheName: "xololingua-model-assets-browser-model-assets-v1",
    cachedUrls: [cachedUrl],
    missingUrls: ["models/translation/nllb-fr-en/manifest.json?v=browser-model-assets-v1"],
    issues: [],
  });
});

test("inspectBrowserModelAssetCache returns an unavailable fallback diagnostic when Cache API is missing", async () => {
  const result = await inspectBrowserModelAssetCache({
    environment: { indexedDB: {} },
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.deepEqual(result.cachedUrls, []);
  assert.deepEqual(result.missingUrls, buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST));
  assert.equal(result.available, false);
  assert.deepEqual(result.issues, ["Cache API is unavailable; browser model assets cannot be verified offline."]);
});

test("resolveBrowserModelAssetBootstrap reports offline-ready only when every required asset is cached", async () => {
  const allUrls = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST);
  const environment = createCacheEnvironment(allUrls);

  const result = await resolveBrowserModelAssetBootstrap({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "offline-ready");
  assert.deepEqual(result.offlineReadyStages, ["transcription", "translation"]);
  assert.deepEqual(result.bootstrapRequiredStages, []);
  assert.deepEqual(result.fallbackRequiredStages, []);
  assert.equal(result.fallback.runtime, null);
  assert.equal(result.fallback.fallbackReason, null);
  assert.deepEqual(result.missingModelAssets, []);
  assert.equal(result.totalMissingBytes, 0);
});

test("resolveBrowserModelAssetBootstrap reports bootstrap-required with missing model asset metadata", async () => {
  const environment = createCacheEnvironment([
    "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1",
  ]);

  const result = await resolveBrowserModelAssetBootstrap({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "bootstrap-required");
  assert.deepEqual(result.offlineReadyStages, ["transcription"]);
  assert.deepEqual(result.bootstrapRequiredStages, ["translation"]);
  assert.deepEqual(result.fallbackRequiredStages, ["translation"]);
  assert.deepEqual(result.missingModelAssets, [
    {
      stage: "translation",
      assetName: "translation-manifest",
      url: "models/translation/nllb-fr-en/manifest.json",
      versionedUrl: "models/translation/nllb-fr-en/manifest.json?v=browser-model-assets-v1",
      bytes: 625_000_000,
      sha256: "pending-real-asset-checksum",
      retryable: true,
    },
  ]);
  assert.deepEqual(result.fallback, {
    runtime: "server-fallback",
    fallbackRequiredStages: ["translation"],
    fallbackReason: "Browser model bootstrap is incomplete; Python fallback remains required for translation.",
    attemptedBrowserStrategy: "nllb-transformers.js",
    missingModelAssets: result.missingModelAssets,
  });
});

test("resolveBrowserModelAssetBootstrap reports unavailable when required browser storage primitives are missing", async () => {
  const result = await resolveBrowserModelAssetBootstrap({
    environment: {},
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.offlineReadyStages, []);
  assert.deepEqual(result.bootstrapRequiredStages, ["transcription", "translation"]);
  assert.deepEqual(result.fallbackRequiredStages, ["transcription", "translation"]);
  assert.match(result.fallback.fallbackReason, /Cache API is unavailable/);
  assert.deepEqual(result.storage, {
    cacheApi: false,
    indexedDb: false,
  });
});

test("resolveBrowserModelAssetBootstrap reports unavailable when cache inspection throws", async () => {
  const result = await resolveBrowserModelAssetBootstrap({
    environment: createCacheEnvironment([], { cacheOpenError: new Error("quota denied") }),
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.fallback.fallbackReason, /quota denied/);
  assert.deepEqual(result.cache.issues, ["Cache API inspection failed: quota denied"]);
});
