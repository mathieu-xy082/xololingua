import test from "node:test";
import assert from "node:assert/strict";

import { mapClientMlProgress } from "../frontend/client_ml_progress.js";

test("model download progress receives a readable file and percentage message", () => {
  assert.deepEqual(mapClientMlProgress({
    stage: "loading-model",
    status: "progress",
    file: "onnx/decoder_model_merged_q4.onnx",
    progress: 42.4,
  }, "translation-warmup"), {
    stage: "loading-model",
    status: "progress",
    file: "onnx/decoder_model_merged_q4.onnx",
    progress: 42,
    message: "Downloading decoder_model_merged_q4.onnx — 42%...",
  });
});

test("worker heartbeat messages remain visible during silent model compilation", () => {
  const event = {
    stage: "loading-model",
    progress: 5,
    message: "OPUS download or compilation is still active — 30.0s elapsed.",
  };

  assert.deepEqual(mapClientMlProgress(event, "translation-warmup"), event);
});
