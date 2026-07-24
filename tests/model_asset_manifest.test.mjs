import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_MODEL_ASSET_MANIFEST,
  buildModelAssetCacheUrls,
  createBrowserModelAssetReport,
  validateBrowserModelAssetManifest,
} from "../frontend/model_asset_manifest.js";

test("browser model asset manifest declares real ASR and translation model decisions without remote asset URLs", () => {
  const issues = validateBrowserModelAssetManifest(BROWSER_MODEL_ASSET_MANIFEST);

  assert.deepEqual(issues, []);
  assert.equal(BROWSER_MODEL_ASSET_MANIFEST.version, "browser-model-assets-v1");
  assert.equal(BROWSER_MODEL_ASSET_MANIFEST.models.transcription.stage, "transcription");
  assert.match(BROWSER_MODEL_ASSET_MANIFEST.models.transcription.modelId, /whisper/i);
  assert.equal(BROWSER_MODEL_ASSET_MANIFEST.models.transcription.provider, "transformers.js");
  assert.equal(BROWSER_MODEL_ASSET_MANIFEST.models.translation.stage, "translation");
  assert.equal(BROWSER_MODEL_ASSET_MANIFEST.models.translation.provider, "transformers.js");
  assert.deepEqual(BROWSER_MODEL_ASSET_MANIFEST.models.translation.languagePairs, [{ source: "fr", target: "en" }]);

  const urls = buildModelAssetCacheUrls(BROWSER_MODEL_ASSET_MANIFEST);
  assert.ok(urls.length >= 2);
  assert.ok(urls.every((url) => url.startsWith("models/")));
  assert.ok(urls.every((url) => url.includes("?v=browser-model-assets-v1")));
  assert.ok(urls.every((url) => !/^https?:\/\//.test(url)));
});

test("browser model asset manifest declares bounded browser-real-model timeouts", () => {
  const { timeouts } = BROWSER_MODEL_ASSET_MANIFEST;

  assert.deepEqual(Object.keys(timeouts), [
    "manifestLoadMs",
    "assetCacheMs",
    "runtimeInitMs",
    "asrWarmupMs",
    "translationWarmupMs",
    "asrInferencePerSegmentMs",
    "translationInferencePerBatchMs",
    "e2eRealModelsMs",
  ]);
  assert.ok(timeouts.manifestLoadMs <= 30_000);
  assert.ok(timeouts.assetCacheMs >= 600_000);
  assert.ok(timeouts.e2eRealModelsMs >= 1_800_000);

  const issues = validateBrowserModelAssetManifest({
    version: "missing-timeouts",
    models: BROWSER_MODEL_ASSET_MANIFEST.models,
  });
  assert.deepEqual(issues, ["manifest.timeouts is required for browser real model stages."]);
});

test("browser model asset report separates offline-ready, bootstrap-required, and fallback stages", () => {
  const report = createBrowserModelAssetReport({
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    cachedUrls: ["models/asr/whisper-tiny/manifest.json?v=browser-model-assets-v1"],
  });

  assert.equal(report.version, "browser-model-assets-v1");
  assert.deepEqual(report.offlineReadyStages, ["transcription"]);
  assert.deepEqual(report.bootstrapRequiredStages, ["translation"]);
  assert.deepEqual(report.fallbackRequiredStages, ["translation"]);
  assert.deepEqual(report.stageRows.map(({ stage, status, requiredBytes, missingBytes }) => ({
    stage,
    status,
    requiredBytes,
    missingBytes,
  })), [
    { stage: "transcription", status: "offline-ready", requiredBytes: 1, missingBytes: 0 },
    { stage: "translation", status: "bootstrap-required", requiredBytes: 1, missingBytes: 1 },
  ]);
  assert.equal(report.totalRequiredBytes, 2);
  assert.equal(report.totalMissingBytes, 1);
  assert.match(report.stageRows[1].fallbackReason, /Model assets are not cached/);
});

test("browser model asset manifest validation rejects remote URLs and missing checksums", () => {
  const invalidManifest = {
    version: "bad",
    timeouts: BROWSER_MODEL_ASSET_MANIFEST.timeouts,
    models: {
      transcription: {
        stage: "transcription",
        provider: "transformers.js",
        strategy: "whisper-transformers.js",
        modelId: "Xenova/whisper-tiny",
        assets: [{ url: "https://example.test/model.bin", bytes: 10, required: true }],
      },
      translation: {
        stage: "translation",
        provider: "transformers.js",
        strategy: "nllb-transformers.js",
        modelId: "Xenova/nllb-200-distilled-600M",
        languagePairs: [{ source: "fr", target: "en" }],
        assets: [{ url: "models/translation/model.bin", bytes: 10, required: true }],
      },
    },
  };

  assert.deepEqual(validateBrowserModelAssetManifest(invalidManifest), [
    "models.transcription.assets[0].url must be a relative local asset path, got https://example.test/model.bin.",
    "models.transcription.assets[0].sha256 is required for cache integrity.",
    "models.translation.assets[0].sha256 is required for cache integrity.",
  ]);
});
