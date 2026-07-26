import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  BROWSER_MODEL_ASSET_MANIFEST,
  buildModelAssetCacheUrls,
} from "../frontend/model_asset_manifest.js";
import {
  bootstrapBrowserModelAssets,
  inspectBrowserModelAssetCache,
  resolveBrowserModelAssetBootstrap,
} from "../frontend/model_asset_bootstrap.js";

function createBootstrapEnvironment({ cachedUrls = [], fetchFailures = new Set(), cacheOpenError } = {}) {
  const cached = new Map(cachedUrls.map((url) => [url, { ok: true, url, cached: true }]));
  const fetchCalls = [];
  const putCalls = [];
  const openedCaches = [];
  return {
    fetchCalls,
    putCalls,
    openedCaches,
    caches: {
      async open(cacheName) {
        openedCaches.push(cacheName);
        if (cacheOpenError) {
          throw cacheOpenError;
        }
        return {
          async match(url) {
            return cached.get(typeof url === "string" ? url : url.url);
          },
          async put(url, response) {
            const key = typeof url === "string" ? url : url.url;
            putCalls.push(key);
            cached.set(key, response);
          },
        };
      },
    },
    indexedDB: {},
    async fetch(url) {
      fetchCalls.push(url);
      if (fetchFailures.has(url)) {
        return { ok: false, status: 503, statusText: "Service Unavailable", url };
      }
      return {
        ok: true,
        status: 200,
        url,
        clone() {
          return { ok: true, status: 200, url, cloned: true };
        },
      };
    },
  };
}

test("inspectBrowserModelAssetCache reads the real Cache API and reports cached versioned URLs", async () => {
  const cachedUrl = "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1";
  const environment = createBootstrapEnvironment({ cachedUrls: [cachedUrl] });

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
  const environment = createBootstrapEnvironment({ cachedUrls: allUrls });

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
  const environment = createBootstrapEnvironment({ cachedUrls: [
    "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1",
  ] });

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
    environment: createBootstrapEnvironment({ cachedUrls: [], cacheOpenError: new Error("quota denied") }),
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.fallback.fallbackReason, /quota denied/);
  assert.deepEqual(result.cache.issues, ["Cache API inspection failed: quota denied"]);
});

test("bootstrapBrowserModelAssets downloads only missing versioned model assets and refreshes the resolver report", async () => {
  const cachedUrl = "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1";
  const missingUrl = "models/translation/nllb-fr-en/manifest.json?v=browser-model-assets-v1";
  const environment = createBootstrapEnvironment({ cachedUrls: [cachedUrl] });
  const events = [];

  const result = await bootstrapBrowserModelAssets({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual(environment.fetchCalls, [missingUrl]);
  assert.deepEqual(environment.putCalls, [missingUrl]);
  assert.equal(result.status, "offline-ready");
  assert.deepEqual(result.report.offlineReadyStages, ["transcription", "translation"]);
  assert.deepEqual(result.downloadedUrls, [missingUrl]);
  assert.deepEqual(result.skippedCachedUrls, [cachedUrl]);
  assert.deepEqual(events.map((event) => event.status), ["cached", "downloading", "cached", "offline-ready"]);
  assert.equal(events.at(-1).remainingBytes, 0);
});

test("bootstrapBrowserModelAssets keeps Python fallback metadata retryable when an asset download fails", async () => {
  const failingUrl = "models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1";
  const environment = createBootstrapEnvironment({ fetchFailures: new Set([failingUrl]) });
  const events = [];

  const result = await bootstrapBrowserModelAssets({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    onProgress: (event) => events.push(event),
  });

  assert.equal(result.status, "bootstrap-required");
  assert.deepEqual(result.failedAssets, [{
    stage: "transcription",
    url: failingUrl,
    status: 503,
    retryable: true,
    error: "Service Unavailable",
  }]);
  assert.deepEqual(result.report.fallbackRequiredStages, ["transcription"]);
  assert.match(result.report.fallback.fallbackReason, /Python fallback remains required for transcription/);
  assert.equal(events.some((event) => event.status === "failed" && event.retryable), true);
});

test("bootstrapBrowserModelAssets rejects checksum mismatches before caching model assets", async () => {
  const manifest = {
    version: "checksum-test-v1",
    models: {
      transcription: {
        stage: "transcription",
        strategy: "whisper-transformers.js",
        assets: [{
          name: "asr-manifest",
          url: "models/asr/whisper-tiny/manifest.json",
          bytes: 4,
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          required: true,
        }],
      },
    },
  };
  const assetUrl = "models/asr/whisper-tiny/manifest.json?v=checksum-test-v1";
  const environment = createBootstrapEnvironment();
  environment.fetch = async (url) => {
    environment.fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      url,
      async arrayBuffer() {
        return new TextEncoder().encode("abcd").buffer;
      },
      clone() {
        return {
          ok: true,
          status: 200,
          url,
          cloned: true,
          async arrayBuffer() {
            return new TextEncoder().encode("abcd").buffer;
          },
        };
      },
    };
  };
  environment.crypto = {
    subtle: {
      async digest(algorithm, arrayBuffer) {
        assert.equal(algorithm, "SHA-256");
        return createHash("sha256").update(Buffer.from(arrayBuffer)).digest().buffer;
      },
    },
  };

  const result = await bootstrapBrowserModelAssets({ environment, manifest });

  assert.deepEqual(environment.fetchCalls, [assetUrl]);
  assert.deepEqual(environment.putCalls, []);
  assert.equal(result.status, "bootstrap-required");
  assert.deepEqual(result.failedAssets, [{
    stage: "transcription",
    url: assetUrl,
    retryable: true,
    error: "sha256 mismatch for asr-manifest",
  }]);
  assert.deepEqual(result.report.fallbackRequiredStages, ["transcription"]);
});
