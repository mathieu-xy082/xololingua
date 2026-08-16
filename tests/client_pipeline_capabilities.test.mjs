import test from "node:test";
import assert from "node:assert/strict";

import {
  collectClientPipelineCapabilities,
  createClientPipelineCapabilityReport,
} from "../frontend/client_pipeline_capabilities.js";

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
  assert.equal(report.stages.transcription.runtime, "browser");
  assert.equal(report.stages.translation.runtime, "server-fallback");
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
  assert.deepEqual(report.offlineAvailability.offlineCapableStages, [
    "audioExtraction",
    "vad",
    "transcription",
    "translation",
  ]);
});

test("client pipeline report exposes fallback labels and direct server endpoints", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "unavailable" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "unavailable" },
    translation: { strategy: "unavailable" },
  });

  assert.match(report.demoSummary.headline, /4 Python fallback stages/);
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

test("client pipeline report separates offline shell assets from backend processing", () => {
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
  assert.match(report.demoSummary.offlineScopeLabel, /still need Python fallback/);
});

test("client pipeline report does not mark browser cloud translation as offline-capable", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "ffmpeg.wasm" },
    vad: { strategy: "vad-web" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "cloud-provider" },
  });

  assert.deepEqual(report.offlineAvailability.onlineRequiredStages, ["translation"]);
  assert.deepEqual(report.offlineAvailability.offlineCapableStages, [
    "audioExtraction",
    "vad",
    "transcription",
  ]);
  assert.match(report.demoSummary.offlineScopeLabel, /Translation needs online model delivery or a browser service/);
});

test("dynamic ML capabilities do not inspect a static model cache", () => {
  const environment = {
    Worker() {},
    __xololinguaDynamicModels: true,
    navigator: {},
    get caches() {
      throw new Error("static model cache must not be inspected");
    },
  };

  const report = collectClientPipelineCapabilities(environment);

  assert.equal(report.stages.transcription.runtime, "browser");
  assert.equal(report.stages.translation.runtime, "browser");
  assert.equal(report.stages.transcription.modelDelivery, "on-demand");
  assert.equal(report.stages.transcription.modelRetention, "purge-after-use");
  assert.equal(report.stages.translation.modelDelivery, "on-demand");
  assert.deepEqual(report.offlineAvailability.onlineRequiredStages, [
    "transcription",
    "translation",
  ]);
  assert.equal(Object.hasOwn(report, "modelAssets"), false);
});
