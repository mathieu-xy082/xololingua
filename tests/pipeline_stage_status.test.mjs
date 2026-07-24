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

test("pipeline stage summary displays missing browser model bootstrap metadata", () => {
  const summary = formatPipelineStageSummary([
    {
      stage: "translation",
      runtime: "server-fallback",
      strategy: "local-transformers.js",
      metadata: {
        fallbackEndpoints: ["POST /api/translate-segments"],
        browserFailureReason: "Model assets are not cached for translation; Python fallback remains required until bootstrap completes.",
        modelAssetBootstrapStatus: "bootstrap-required",
        remainingModelAssetBytes: 625_000_000,
        missingModelAssets: [
          { assetName: "translation-manifest", path: "models/translation/nllb-fr-en/manifest.json" },
        ],
      },
    },
  ]);

  assert.equal(
    summary,
    "Translation: Python fallback (local-transformers.js) via POST /api/translate-segments — fallback reason: Model assets are not cached for translation; Python fallback remains required until bootstrap completes. — model bootstrap: bootstrap-required, 596.0 MB remaining, missing translation-manifest",
  );
});
