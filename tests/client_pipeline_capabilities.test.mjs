import test from "node:test";
import assert from "node:assert/strict";

import {
  collectClientPipelineCapabilities,
  collectClientPipelineCapabilitiesWithModelAssetBootstrap,
  createClientPipelineCapabilityReport,
} from "../frontend/client_pipeline_capabilities.js";
import { BROWSER_MODEL_ASSET_MANIFEST } from "../frontend/model_asset_manifest.js";

function versionedStageUrls(stageName, manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return manifest.models[stageName].assets.map((asset) => `${asset.url}?v=${manifest.version}`);
}

function sumAssetBytes(stageName, manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return manifest.models[stageName].assets.reduce((total, asset) => total + asset.bytes, 0);
}

test("client pipeline report identifies browser-ready stages and server fallback stages", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "ffmpeg.wasm" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "unavailable" },
  });

  assert.equal(report.mode, "hybrid-fallback");
  assert.deepEqual(report.browserStages, ["audioExtraction", "transcription"]);
  assert.deepEqual(report.serverFallbackStages, ["vad", "translation"]);
  assert.deepEqual(report.stages, {
    audioExtraction: { strategy: "ffmpeg.wasm", runtime: "browser" },
    vad: { strategy: "unavailable", runtime: "server-fallback" },
    transcription: { strategy: "transformers.js", runtime: "browser" },
    translation: { strategy: "unavailable", runtime: "server-fallback" },
  });
});

test("client pipeline report marks an all-browser flow as client-side", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "webcodecs" },
    vad: { strategy: "vad-web" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "local-transformers.js" },
  });

  assert.equal(report.mode, "client-side");
  assert.deepEqual(report.serverFallbackStages, []);
});

test("client pipeline report includes demo-ready fallback labels and server endpoints", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "webcodecs" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "unavailable" },
  });

  assert.deepEqual(report.demoSummary, {
    headline: "Hybrid PWA: 2 browser stages, 2 Python fallback stages",
    offlineScopeLabel: "Offline assets available; processing is partial and VAD / segmentation, Translation still need Python fallback.",
    browserStageLabels: ["Audio extraction", "Transcription"],
    serverFallbackStageLabels: ["VAD / segmentation", "Translation"],
    serverFallbackEndpoints: [
      { stage: "vad", label: "VAD / segmentation", endpoints: ["POST /api/segment-audio"] },
      {
        stage: "translation",
        label: "Translation",
        endpoints: ["POST /api/translate-segments", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
      },
    ],
    stageRows: [
      {
        stage: "audioExtraction",
        label: "Audio extraction",
        runtimeLabel: "Browser",
        strategy: "webcodecs",
        fallbackEndpoints: [],
        offlineCapable: true,
        onlineRequired: false,
      },
      {
        stage: "vad",
        label: "VAD / segmentation",
        runtimeLabel: "Python fallback",
        strategy: "unavailable",
        fallbackEndpoints: ["POST /api/segment-audio"],
        offlineCapable: false,
        onlineRequired: false,
      },
      {
        stage: "transcription",
        label: "Transcription",
        runtimeLabel: "Browser",
        strategy: "transformers.js",
        fallbackEndpoints: [],
        offlineCapable: true,
        onlineRequired: false,
      },
      {
        stage: "translation",
        label: "Translation",
        runtimeLabel: "Python fallback",
        strategy: "unavailable",
        fallbackEndpoints: ["POST /api/translate-segments", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
        offlineCapable: false,
        onlineRequired: false,
      },
    ],
  });
});

test("client pipeline fallback endpoint metadata names direct backend fallbacks before subtitle jobs", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "unavailable" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "unavailable" },
    translation: { strategy: "unavailable" },
  });

  assert.deepEqual(
    report.demoSummary.serverFallbackEndpoints.map(({ stage, endpoints }) => ({ stage, endpoints })),
    [
      { stage: "audioExtraction", endpoints: ["POST /api/extract-audio"] },
      { stage: "vad", endpoints: ["POST /api/segment-audio"] },
      {
        stage: "transcription",
        endpoints: ["POST /api/transcribe-audio", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
      },
      {
        stage: "translation",
        endpoints: ["POST /api/translate-segments", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
      },
    ],
  );
});

test("client pipeline report separates offline shell assets from backend-only processing stages", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "ffmpeg.wasm" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "unavailable" },
    translation: { strategy: "unavailable" },
  });

  assert.deepEqual(report.offlineAvailability, {
    assets: "available",
    processing: "partial-browser-with-python-fallback",
    offlineCapableStages: ["audioExtraction"],
    backendRequiredStages: ["vad", "transcription", "translation"],
    onlineRequiredStages: [],
  });
  assert.equal(
    report.demoSummary.offlineScopeLabel,
    "Offline assets available; processing is partial and VAD / segmentation, Transcription, Translation still need Python fallback.",
  );
});

test("client pipeline report marks model assets as bootstrap-required when ML weights are not cached", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "ffmpeg.wasm" },
    vad: { strategy: "vad-web" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "local-transformers.js" },
    modelAssets: {
      status: "bootstrap-required",
      offlineReadyStages: ["transcription"],
      bootstrapRequiredStages: ["translation"],
      totalMissingBytes: sumAssetBytes("translation"),
      stageRows: [],
    },
  });

  assert.equal(report.offlineAvailability.assets, "bootstrap-required");
  assert.equal(
    report.demoSummary.offlineScopeLabel,
    "Model assets need bootstrap before full offline ML processing; Audio extraction, VAD / segmentation, Transcription, Translation can run offline after assets are ready.",
  );
});

test("client pipeline report does not mark browser cloud translation as offline-capable", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "ffmpeg.wasm" },
    vad: { strategy: "vad-web" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "cloud-provider" },
  });

  assert.deepEqual(report.browserStages, ["audioExtraction", "vad", "transcription", "translation"]);
  assert.deepEqual(report.serverFallbackStages, []);
  assert.deepEqual(report.offlineAvailability, {
    assets: "available",
    processing: "browser-with-online-service",
    offlineCapableStages: ["audioExtraction", "vad", "transcription"],
    backendRequiredStages: [],
    onlineRequiredStages: ["translation"],
  });
  assert.equal(
    report.demoSummary.offlineScopeLabel,
    "Offline assets available; Audio extraction, VAD / segmentation, Transcription can run offline, but Translation needs an online browser/cloud provider.",
  );
  assert.deepEqual(
    report.demoSummary.stageRows.map(({ stage, offlineCapable, onlineRequired }) => ({ stage, offlineCapable, onlineRequired })),
    [
      { stage: "audioExtraction", offlineCapable: true, onlineRequired: false },
      { stage: "vad", offlineCapable: true, onlineRequired: false },
      { stage: "transcription", offlineCapable: true, onlineRequired: false },
      { stage: "translation", offlineCapable: false, onlineRequired: true },
    ],
  );
});

test("collectClientPipelineCapabilities requires cached model assets before marking ML stages browser-ready", () => {
  const report = collectClientPipelineCapabilities({
    VideoDecoder: function VideoDecoder() {},
    AudioDecoder: function AudioDecoder() {},
    AudioContext: function AudioContext() {},
    vad: {
      NonRealTimeVAD: { new: async () => ({}) },
      utils: { audioFileToArray: async () => ({ audio: new Float32Array(), sampleRate: 16000 }) },
    },
    ort: { env: { wasm: {} } },
    Worker: function Worker() {},
    navigator: { gpu: {} },
    transformers: { pipeline: function pipeline() {} },
    __xololinguaCachedModelAssetUrls: versionedStageUrls("transcription"),
  });

  assert.equal(report.mode, "hybrid-fallback");
  assert.deepEqual(report.browserStages, ["audioExtraction", "vad", "transcription"]);
  assert.deepEqual(report.serverFallbackStages, ["translation"]);
  assert.equal(report.stages.audioExtraction.strategy, "webcodecs");
  assert.equal(report.stages.vad.strategy, "vad-web");
  assert.equal(report.stages.transcription.strategy, "transformers.js");
  assert.equal(report.stages.translation.strategy, "local-transformers.js");
  assert.equal(report.stages.translation.runtime, "server-fallback");
  assert.equal(
    report.stages.translation.browserFailureReason,
    "Model assets are not cached for translation; Python fallback remains required until bootstrap completes.",
  );
  assert.equal(report.stages.translation.attemptedBrowserStrategy, "opus-mt-transformers.js");
  assert.deepEqual(report.modelAssets.offlineReadyStages, ["transcription"]);
  assert.deepEqual(report.modelAssets.bootstrapRequiredStages, ["translation"]);
  assert.match(report.modelAssets.stageRows[1].fallbackReason, /Model assets are not cached/);
});

test("collectClientPipelineCapabilitiesWithModelAssetBootstrap uses the real browser cache resolver", async () => {
  const openedCaches = [];
  const environment = {
    VideoDecoder: function VideoDecoder() {},
    AudioDecoder: function AudioDecoder() {},
    AudioContext: function AudioContext() {},
    vad: {
      NonRealTimeVAD: { new: async () => ({}) },
      utils: { audioFileToArray: async () => ({ audio: new Float32Array(), sampleRate: 16000 }) },
    },
    ort: { env: { wasm: {} } },
    Worker: function Worker() {},
    navigator: { gpu: {} },
    transformers: { pipeline: function pipeline() {} },
    indexedDB: {},
    caches: {
      async open(cacheName) {
        openedCaches.push(cacheName);
        return {
          async match(url) {
            return versionedStageUrls("transcription").includes(url) ? { ok: true, url } : undefined;
          },
        };
      },
    },
  };

  const report = await collectClientPipelineCapabilitiesWithModelAssetBootstrap(environment);

  assert.deepEqual(openedCaches, ["xololingua-model-assets-browser-model-assets-v1"]);
  assert.equal(report.modelAssets.status, "bootstrap-required");
  assert.deepEqual(report.modelAssets.offlineReadyStages, ["transcription"]);
  assert.deepEqual(report.modelAssets.fallbackRequiredStages, ["translation"]);
  assert.equal(report.stages.transcription.runtime, "browser");
  assert.equal(report.stages.translation.runtime, "server-fallback");
  assert.deepEqual(
    report.stages.translation.missingModelAssets.map((asset) => asset.assetName),
    BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets.map((asset) => asset.name),
  );
});

test("client pipeline demo summary surfaces model bootstrap details for fallback stages", async () => {
  const environment = {
    VideoDecoder: function VideoDecoder() {},
    AudioDecoder: function AudioDecoder() {},
    AudioContext: function AudioContext() {},
    vad: {
      NonRealTimeVAD: { new: async () => ({}) },
      utils: { audioFileToArray: async () => ({ audio: new Float32Array(), sampleRate: 16000 }) },
    },
    ort: { env: { wasm: {} } },
    Worker: function Worker() {},
    navigator: { gpu: {} },
    transformers: { pipeline: function pipeline() {} },
    indexedDB: {},
    caches: {
      async open() {
        return { async match() { return undefined; } };
      },
    },
  };

  const report = await collectClientPipelineCapabilitiesWithModelAssetBootstrap(environment);
  const translationRow = report.demoSummary.stageRows.find((row) => row.stage === "translation");

  assert.equal(translationRow.modelAssetBootstrapStatus, "bootstrap-required");
  assert.equal(translationRow.remainingModelAssetBytes, sumAssetBytes("translation"));
  assert.equal(translationRow.modelAssetBootstrapLabel, "Model bootstrap required: 270.2 MB remaining; missing translation-manifest + 11 more");
  assert.deepEqual(
    translationRow.missingModelAssets.map((asset) => asset.assetName),
    BROWSER_MODEL_ASSET_MANIFEST.models.translation.assets.map((asset) => asset.name),
  );
});
