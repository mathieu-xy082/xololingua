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

function versionedStageUrls(stageName, manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return manifest.models[stageName].assets.map((asset) => `${asset.url}?v=${manifest.version}`);
}

function modelAssetShaByVersionedUrl(manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  const byUrl = new Map();
  for (const model of Object.values(manifest.models)) {
    for (const asset of model.assets) {
      byUrl.set(`${asset.url}?v=${manifest.version}`, asset.sha256);
    }
  }
  return byUrl;
}

function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function createBootstrapEnvironment({ cachedUrls = [], fetchFailures = new Set(), cacheOpenError, manifest = BROWSER_MODEL_ASSET_MANIFEST } = {}) {
  const shaByUrl = modelAssetShaByVersionedUrl(manifest);
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
        async arrayBuffer() {
          return new TextEncoder().encode(url).buffer;
        },
        clone() {
          return {
            ok: true,
            status: 200,
            url,
            cloned: true,
            async arrayBuffer() {
              return new TextEncoder().encode(url).buffer;
            },
          };
        },
      };
    },
    crypto: {
      subtle: {
        async digest(_algorithm, arrayBuffer) {
          const url = new TextDecoder().decode(arrayBuffer);
          const expected = shaByUrl.get(url);
          if (expected) return hexToArrayBuffer(expected);
          return createHash("sha256").update(new Uint8Array(arrayBuffer)).digest().buffer;
        },
      },
    },
  };
}

test("inspectBrowserModelAssetCache reads the real Cache API and reports cached versioned URLs", async () => {
  const cachedUrl = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST)
    .find((url) => url.includes("/asr/"));
  assert.ok(cachedUrl);
  const environment = createBootstrapEnvironment({ cachedUrls: [cachedUrl] });

  const result = await inspectBrowserModelAssetCache({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.deepEqual(environment.openedCaches, ["xololingua-model-assets-browser-model-assets-v1"]);
  const allUrls = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST);
  assert.deepEqual(result, {
    available: true,
    cacheName: "xololingua-model-assets-browser-model-assets-v1",
    cachedUrls: [cachedUrl],
    missingUrls: allUrls.filter((url) => url !== cachedUrl),
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
  const environment = createBootstrapEnvironment({ cachedUrls: versionedStageUrls("transcription") });

  const result = await resolveBrowserModelAssetBootstrap({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
  });

  assert.equal(result.status, "bootstrap-required");
  assert.deepEqual(result.offlineReadyStages, ["transcription"]);
  assert.deepEqual(result.bootstrapRequiredStages, ["translation"]);
  assert.deepEqual(result.fallbackRequiredStages, ["translation"]);
  const translationAssets = BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets;
  assert.equal(result.missingModelAssets.length, translationAssets.length);
  assert.deepEqual(result.missingModelAssets.map((asset) => asset.stage), translationAssets.map(() => "translation"));
  assert.deepEqual(result.missingModelAssets.map((asset) => asset.versionedUrl), versionedStageUrls("translation"));
  assert.equal(result.missingModelAssets[0].assetName, "translation-manifest");
  assert.match(result.missingModelAssets[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.fallback, {
    runtime: "server-fallback",
    fallbackRequiredStages: ["translation"],
    fallbackReason: "Browser model bootstrap is incomplete; Python fallback remains required for translation.",
    attemptedBrowserStrategy: "opus-mt-transformers.js",
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
  const cachedUrls = versionedStageUrls("transcription");
  const missingUrls = versionedStageUrls("translation");
  const environment = createBootstrapEnvironment({ cachedUrls });
  const events = [];

  const result = await bootstrapBrowserModelAssets({
    environment,
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual(environment.fetchCalls, missingUrls);
  assert.deepEqual(environment.putCalls, missingUrls);
  assert.equal(result.status, "offline-ready");
  assert.deepEqual(result.report.offlineReadyStages, ["transcription", "translation"]);
  assert.deepEqual(result.downloadedUrls, missingUrls);
  assert.deepEqual(result.skippedCachedUrls, cachedUrls);
  assert.equal(events.filter((event) => event.status === "downloading").length, missingUrls.length);
  assert.equal(events.filter((event) => event.status === "cached").length, cachedUrls.length + missingUrls.length);
  assert.equal(events.at(-1).status, "offline-ready");
  assert.equal(events.at(-1).remainingBytes, 0);
});

test("bootstrapBrowserModelAssets keeps Python fallback metadata retryable when an asset download fails", async () => {
  const failingUrl = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST)
    .find((url) => url.includes("/asr/"));
  assert.ok(failingUrl);
  const cachedUrls = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST).filter((url) => url !== failingUrl);
  const environment = createBootstrapEnvironment({ cachedUrls, fetchFailures: new Set([failingUrl]) });
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

test("bootstrapBrowserModelAssets streams large assets without browser-side sha256 arrayBuffer materialization", async () => {
  const manifest = {
    version: "large-asset-v1",
    models: {
      translation: {
        stage: "translation",
        strategy: "nllb-transformers.js",
        assets: [{
          name: "large-decoder",
          url: "models/Xenova/nllb/onnx/decoder_model_merged_q4.onnx",
          bytes: 128 * 1024 * 1024,
          sha256: "fbea01de69bf0f342d67d035bceb7baa3c25b31213c54e4a630a92554684a293",
          required: true,
        }],
      },
    },
  };
  const assetUrl = "models/Xenova/nllb/onnx/decoder_model_merged_q4.onnx?v=large-asset-v1";
  const environment = createBootstrapEnvironment({ manifest });
  let arrayBufferCalls = 0;
  environment.fetch = async (url) => {
    environment.fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      url,
      async arrayBuffer() {
        arrayBufferCalls += 1;
        throw new Error("large asset should not be buffered for checksum");
      },
      clone() {
        return {
          ok: true,
          status: 200,
          url,
          cloned: true,
          async arrayBuffer() {
            arrayBufferCalls += 1;
            throw new Error("large asset should not be buffered for checksum");
          },
        };
      },
    };
  };

  const result = await bootstrapBrowserModelAssets({ environment, manifest });

  assert.equal(result.status, "offline-ready");
  assert.deepEqual(result.failedAssets, []);
  assert.deepEqual(result.downloadedUrls, [assetUrl]);
  assert.deepEqual(environment.putCalls, [assetUrl]);
  assert.equal(arrayBufferCalls, 0);
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
