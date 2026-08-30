import test from "node:test";
import assert from "node:assert/strict";

import { formatPipelineStageSummary } from "../frontend/pipeline_stage_status.js";

test("pipeline stage summary names browser and Python fallback stages with endpoints and fallback reason", () => {
  const summary = formatPipelineStageSummary([
    {
      stage: "audioExtraction",
      runtime: "browser",
      strategy: "ffmpeg.wasm",
    },
    {
      stage: "vad",
      runtime: "server-fallback",
      strategy: "python-backend",
      fallbackEndpoints: ["POST /api/segment-audio"],
      browserFailureReason: "WebAudio VAD unavailable",
    },
  ]);

  assert.equal(
    summary,
    "Audio extraction: Browser (ffmpeg.wasm); VAD / segmentation: Python fallback (python-backend) via POST /api/segment-audio — fallback reason: WebAudio VAD unavailable",
  );
});

test("pipeline stage summary reads fallback endpoints and reason from canonical metadata", () => {
  const summary = formatPipelineStageSummary([
    {
      stage: "transcription",
      runtime: "server-fallback",
      strategy: "python-backend",
      metadata: {
        fallbackEndpoints: ["POST /api/transcribe-audio", "POST /api/subtitle-jobs"],
        browserFailureReason: "WebGPU unavailable",
      },
    },
  ]);

  assert.equal(
    summary,
    "Transcription: Python fallback (python-backend) via POST /api/transcribe-audio, POST /api/subtitle-jobs — fallback reason: WebGPU unavailable",
  );
});

test("pipeline stage summary exposes the browser device and French to Spanish pivot models", () => {
  const summary = formatPipelineStageSummary([{
    stage: "translation",
    runtime: "browser",
    strategy: "remote-transformers.js",
    metadata: {
      executionDevice: "webgpu",
      executionDeviceLabel: "WebGPU (NVIDIA Lovelace)",
      translationRoute: [
        { sourceLanguage: "fr", targetLanguage: "en", modelId: "Xenova/opus-mt-fr-en" },
        { sourceLanguage: "en", targetLanguage: "es", modelId: "Xenova/opus-mt-en-es" },
      ],
    },
  }]);

  assert.equal(
    summary,
    "Translation: Browser (remote-transformers.js) on WebGPU (NVIDIA Lovelace) via fr → en → es using Xenova/opus-mt-fr-en then Xenova/opus-mt-en-es",
  );
});
