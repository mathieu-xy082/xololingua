import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAudioExtractionStageResult,
  normalizeVadStageResult,
} from "../frontend/pipeline_stage_contract.js";

test("normalizes browser audio extraction into the canonical stage envelope", () => {
  const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

  const result = normalizeAudioExtractionStageResult({
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: {
      audioBlob,
      mimeType: "audio/wav",
      sampleRate: 16000,
      durationSeconds: 12.5,
    },
    metadata: {
      audioFileName: "clip.wav",
      audioSizeBytes: 3,
    },
  });

  assert.deepEqual(result, {
    stage: "audioExtraction",
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: {
      audioId: null,
      audioBlob,
      storage: "browser",
      mimeType: "audio/wav",
      sampleRateHz: 16000,
      durationSeconds: 12.5,
    },
    metadata: {
      audioFileName: "clip.wav",
      audioSizeBytes: 3,
    },
  });
});

test("rejects successful audio extraction envelopes without a browser blob or server audio id handoff", () => {
  assert.throws(
    () => normalizeAudioExtractionStageResult({
      runtime: "server-fallback",
      strategy: "python-ffmpeg",
      payload: { audioFileName: "empty.wav" },
    }),
    /Audio extraction stage result requires audioId or audioBlob for downstream handoff\./,
  );
});

test("normalizes VAD segmentation arrays into the canonical stage envelope", () => {
  const result = normalizeVadStageResult({
    runtime: "server-fallback",
    strategy: "python-vad",
    payload: [
      { start: 0.12, end: 1.34, confidence: 0.91 },
      { start: 2.5, end: 3.75 },
    ],
    metadata: {
      fallbackEndpoints: ["POST /api/segment-audio"],
    },
  });

  assert.deepEqual(result, {
    stage: "vad",
    runtime: "server-fallback",
    strategy: "python-vad",
    payload: {
      segments: [
        { start: 0.12, end: 1.34, confidence: 0.91 },
        { start: 2.5, end: 3.75 },
      ],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/segment-audio"],
    },
  });
});
