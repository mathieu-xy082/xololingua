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
      },
      {
        stage: "vad",
        label: "VAD / segmentation",
        runtimeLabel: "Python fallback",
        strategy: "unavailable",
        fallbackEndpoints: ["POST /api/segment-audio"],
      },
      {
        stage: "transcription",
        label: "Transcription",
        runtimeLabel: "Browser",
        strategy: "transformers.js",
        fallbackEndpoints: [],
      },
      {
        stage: "translation",
        label: "Translation",
        runtimeLabel: "Python fallback",
        strategy: "unavailable",
        fallbackEndpoints: ["POST /api/translate-segments", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
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
  });
  assert.equal(
    report.demoSummary.offlineScopeLabel,
    "Offline assets available; processing is partial and VAD / segmentation, Transcription, Translation still need Python fallback.",
  );
});

test("collectClientPipelineCapabilities builds a report from browser feature probes", () => {
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
  });

  assert.equal(report.mode, "client-side");
  assert.deepEqual(report.browserStages, [
    "audioExtraction",
    "vad",
    "transcription",
    "translation",
  ]);
  assert.equal(report.stages.audioExtraction.strategy, "webcodecs");
  assert.equal(report.stages.vad.strategy, "vad-web");
  assert.equal(report.stages.transcription.strategy, "transformers.js");
  assert.equal(report.stages.translation.strategy, "local-transformers.js");
});
