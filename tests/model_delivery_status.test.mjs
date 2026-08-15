import test from "node:test";
import assert from "node:assert/strict";

import {
  beginModelDelivery,
  createModelDeliveryTracker,
  describeModelDelivery,
  finishModelDelivery,
  updateModelDelivery,
} from "../frontend/model_delivery_status.js";

test("model delivery status reports real worker file progress", () => {
  let tracker = beginModelDelivery(createModelDeliveryTracker(), {
    stage: "transcription",
    modelId: "Xenova/whisper-base",
  });
  tracker = updateModelDelivery(tracker, {
    stage: "loading-model",
    file: "onnx/model_quantized.onnx",
    loaded: 50 * 1024 * 1024,
    total: 100 * 1024 * 1024,
    progress: 50,
  });

  assert.deepEqual(describeModelDelivery(tracker), {
    status: "Downloading Xenova/whisper-base — model_quantized.onnx...",
    progress: 50,
    progressText: "50% · 50.0 MB / 100.0 MB · 0/1 assets",
  });
});

test("model delivery status does not report a tiny completed asset as the whole model", () => {
  let tracker = beginModelDelivery(createModelDeliveryTracker(), {
    stage: "transcription",
    modelId: "Xenova/whisper-base",
  });
  tracker = updateModelDelivery(tracker, {
    stage: "loading-model",
    status: "done",
    file: "preprocessor_config.json",
    loaded: 339,
    total: 339,
    progress: 100,
  });

  assert.deepEqual(describeModelDelivery(tracker), {
    status: "Downloading Xenova/whisper-base — preprocessor_config.json...",
    progress: 5,
    progressText: "5% · 339 B / 339 B · 1/1 assets",
  });
});

test("model delivery status aggregates parallel asset downloads and selects the largest active file", () => {
  let tracker = beginModelDelivery(createModelDeliveryTracker(), {
    stage: "transcription",
    modelId: "Xenova/whisper-base",
  });
  tracker = updateModelDelivery(tracker, {
    stage: "loading-model",
    status: "done",
    file: "preprocessor_config.json",
    loaded: 339,
    total: 339,
  });
  tracker = updateModelDelivery(tracker, {
    stage: "loading-model",
    status: "progress",
    file: "onnx/model_quantized.onnx",
    loaded: 25 * 1024 * 1024,
    total: 100 * 1024 * 1024,
    progress: 25,
  });

  assert.deepEqual(describeModelDelivery(tracker), {
    status: "Downloading Xenova/whisper-base — model_quantized.onnx...",
    progress: 25,
    progressText: "25% · 25.0 MB / 100.0 MB · 1/2 assets",
  });
});

test("model delivery status only claims purge after worker confirmation", () => {
  let tracker = beginModelDelivery(createModelDeliveryTracker(), {
    stage: "transcription",
    modelId: "Xenova/whisper-base",
  });
  tracker = finishModelDelivery(tracker, {
    modelId: "Xenova/whisper-base",
    stageResult: {
      stage: "transcription",
      runtime: "browser",
      metadata: { cachePurged: true, filesDeleted: 7 },
    },
  });
  tracker = beginModelDelivery(tracker, {
    stage: "translation",
    modelId: "Xenova/opus-mt-fr-ru",
  });
  tracker = finishModelDelivery(tracker, {
    modelId: "Xenova/opus-mt-fr-ru",
    stageResult: {
      stage: "translation",
      runtime: "browser",
      metadata: { cachePurged: true, filesDeleted: 5 },
    },
  });

  assert.deepEqual(describeModelDelivery(tracker), {
    status: "Browser models used successfully; transient cache purge confirmed (12 cached files deleted).",
    progress: 100,
    progressText: "purged",
  });
});

test("model delivery status exposes an unconfirmed purge", () => {
  let tracker = beginModelDelivery(createModelDeliveryTracker(), {
    stage: "transcription",
    modelId: "Xenova/whisper-base",
  });
  tracker = finishModelDelivery(tracker, {
    modelId: "Xenova/whisper-base",
    stageResult: {
      stage: "transcription",
      runtime: "browser",
      metadata: { cachePurged: false, purgeError: "cache unavailable" },
    },
  });

  assert.deepEqual(describeModelDelivery(tracker), {
    status: "Models were used, but transient cache purge could not be confirmed: cache unavailable",
    progress: 100,
    progressText: "purge unconfirmed",
  });
});
