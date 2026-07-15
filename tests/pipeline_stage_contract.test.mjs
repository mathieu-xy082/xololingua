import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAudioExtractionStageResult,
  normalizeTranscriptionStageResult,
  normalizeTranslationStageResult,
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

test("transcription stage normalization wraps Python fallback segments in the canonical envelope", () => {
  const result = normalizeTranscriptionStageResult({
    runtime: "server-fallback",
    strategy: "faster-whisper",
    payload: [
      { index: 1, start: 0, end: 1.5, text: "Bonjour" },
    ],
    metadata: { fallbackEndpoints: ["POST /api/transcribe-audio"] },
  });

  assert.deepEqual(result, {
    stage: "transcription",
    runtime: "server-fallback",
    strategy: "faster-whisper",
    payload: {
      segments: [
        { index: 1, start: 0, end: 1.5, text: "Bonjour" },
      ],
    },
    metadata: { fallbackEndpoints: ["POST /api/transcribe-audio"] },
  });
});

test("transcription stage normalization rejects payloads without a segments handoff", () => {
  assert.throws(
    () => normalizeTranscriptionStageResult({
      runtime: "browser",
      strategy: "transformers-js",
      payload: { transcript: "Bonjour" },
    }),
    /Transcription stage result requires a segments array payload\./,
  );
});

test("translation stage normalization wraps browser translated segments in the canonical envelope", () => {
  const result = normalizeTranslationStageResult({
    runtime: "browser",
    strategy: "local-transformers.js",
    payload: [
      { index: 1, text: "Bonjour", translatedText: "Hello" },
    ],
  });

  assert.deepEqual(result, {
    stage: "translation",
    runtime: "browser",
    strategy: "local-transformers.js",
    payload: {
      segments: [
        { index: 1, text: "Bonjour", translatedText: "Hello" },
      ],
    },
    metadata: {},
  });
});
