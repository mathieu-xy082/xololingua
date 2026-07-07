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

test("client pipeline report includes demo-ready fallback labels", () => {
  const report = createClientPipelineCapabilityReport({
    audioExtraction: { strategy: "webcodecs" },
    vad: { strategy: "unavailable" },
    transcription: { strategy: "transformers.js" },
    translation: { strategy: "unavailable" },
  });

  assert.deepEqual(report.demoSummary, {
    headline: "Hybrid PWA: 2 browser stages, 2 Python fallback stages",
    browserStageLabels: ["Audio extraction", "Transcription"],
    serverFallbackStageLabels: ["VAD / segmentation", "Translation"],
  });
});

test("collectClientPipelineCapabilities builds a report from browser feature probes", () => {
  const report = collectClientPipelineCapabilities({
    VideoDecoder: function VideoDecoder() {},
    AudioDecoder: function AudioDecoder() {},
    AudioContext: function AudioContext() {},
    vad: { MicVAD: function MicVAD() {} },
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
