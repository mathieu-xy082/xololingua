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
