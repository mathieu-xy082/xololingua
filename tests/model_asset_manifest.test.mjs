import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_MODEL_ASSET_MANIFEST,
  buildModelAssetBootstrapPlan,
  buildModelAssetCacheUrls,
  createBrowserModelAssetReport,
  validateBrowserModelAssetManifest,
} from "../frontend/model_asset_manifest.js";

function versionedStageUrls(stageName, manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return manifest.models[stageName].assets.map((asset) => `${asset.url}?v=${manifest.version}`);
}

function sumAssetBytes(stageName, manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return manifest.models[stageName].assets.reduce((total, asset) => total + asset.bytes, 0);
}

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
  const cachedTranscriptionUrls = versionedStageUrls("transcription");
  const transcriptionBytes = sumAssetBytes("transcription");
  const translationBytes = sumAssetBytes("translation");
  const report = createBrowserModelAssetReport({
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    cachedUrls: cachedTranscriptionUrls,
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
    { stage: "transcription", status: "offline-ready", requiredBytes: transcriptionBytes, missingBytes: 0 },
    { stage: "translation", status: "bootstrap-required", requiredBytes: translationBytes, missingBytes: translationBytes },
  ]);
  assert.equal(report.totalRequiredBytes, transcriptionBytes + translationBytes);
  assert.equal(report.totalMissingBytes, translationBytes);
  assert.match(report.stageRows[1].fallbackReason, /Model assets are not cached/);
});

test("browser model asset bootstrap plan describes uncached assets with progress, retry, and fallback metadata", () => {
  const cachedTranscriptionUrls = versionedStageUrls("transcription");
  const transcriptionBytes = sumAssetBytes("transcription");
  const translationBytes = sumAssetBytes("translation");
  const plan = buildModelAssetBootstrapPlan({
    manifest: BROWSER_MODEL_ASSET_MANIFEST,
    cachedUrls: cachedTranscriptionUrls,
  });

  assert.equal(plan.version, "browser-model-assets-v1");
  assert.equal(plan.status, "bootstrap-required");
  assert.equal(plan.totalAssets, BROWSER_MODEL_ASSET_MANIFEST.models.transcription.assets.length + BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets.length);
  assert.equal(plan.cachedAssets, BROWSER_MODEL_ASSET_MANIFEST.models.transcription.assets.length);
  assert.equal(plan.remainingAssets, BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets.length);
  assert.equal(plan.totalBytes, transcriptionBytes + translationBytes);
  assert.equal(plan.remainingBytes, translationBytes);
  assert.deepEqual(plan.steps.filter((step) => step.stage === "transcription").map((step) => step.status),
    BROWSER_MODEL_ASSET_MANIFEST.models.transcription.assets.map(() => "cached"));
  assert.deepEqual(plan.steps.filter((step) => step.stage === "translation").map((step) => step.status),
    BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets.map(() => "pending-download"));
  assert.equal(plan.steps[0].assetName, "asr-manifest");
  assert.equal(plan.steps[0].retryable, false);
  assert.equal(plan.steps[0].progressWeightBytes, BROWSER_MODEL_ASSET_MANIFEST.models.transcription.assets[0].bytes);
  const firstTranslationStep = plan.steps.find((step) => step.stage === "translation");
  assert.equal(firstTranslationStep.assetName, "translation-manifest");
  assert.equal(firstTranslationStep.retryable, true);
  assert.deepEqual(plan.fallback, {
    runtime: "server-fallback",
    fallbackRequiredStages: ["translation"],
    fallbackReason: "Browser model bootstrap is incomplete; Python fallback remains required for translation.",
  });
});

test("browser model asset manifest validation rejects missing asset byte sizes used for bootstrap progress", () => {
  const invalidManifest = {
    version: "missing-bytes",
    timeouts: BROWSER_MODEL_ASSET_MANIFEST.timeouts,
    models: {
      transcription: {
        ...BROWSER_MODEL_ASSET_MANIFEST.models.transcription,
        assets: [{ name: "asr", url: "models/asr/manifest.json", sha256: "abc", required: true }],
      },
      translation: BROWSER_MODEL_ASSET_MANIFEST.models.translation,
    },
  };

  assert.deepEqual(validateBrowserModelAssetManifest(invalidManifest), [
    "models.transcription.assets[0].bytes must be a positive number for bootstrap progress.",
  ]);
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
