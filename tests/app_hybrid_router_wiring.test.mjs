import test from "node:test";
import assert from "node:assert/strict";

import { createAppHybridPipelineRouter } from "../frontend/app_hybrid_router_wiring.js";

test("app hybrid router wiring keeps audio extraction and VAD on explicit Python fallback adapters", async () => {
  const calls = [];
  const backendClient = {
    extractAudio: async (file, onProgress) => {
      calls.push(["extractAudio", file.name]);
      onProgress(35);
      return { audioId: "audio-123", audioFileName: "clip.wav", audioSizeBytes: 4096 };
    },
    segmentAudio: async (audioId, onProgress) => {
      calls.push(["segmentAudio", audioId]);
      onProgress(100);
      return [{ index: 1, start: 0, end: 1.5, text: "Speech segment 1" }];
    },
  };
  const router = createAppHybridPipelineRouter({
    backendClient,
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "python-backend" },
        vad: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });
  const progress = [];

  const extraction = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(["audio", value]));
  const segmentation = await router.runVadSegmentation(extraction.payload.audioId, (value) => progress.push(["vad", value]));

  assert.deepEqual(calls, [
    ["extractAudio", "clip.mp4"],
    ["segmentAudio", "audio-123"],
  ]);
  assert.deepEqual(progress, [
    ["audio", 35],
    ["vad", 100],
  ]);
  assert.deepEqual(extraction, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/extract-audio"],
    payload: { audioId: "audio-123", audioFileName: "clip.wav", audioSizeBytes: 4096 },
  });
  assert.deepEqual(segmentation, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/segment-audio"],
    payload: [{ index: 1, start: 0, end: 1.5, text: "Speech segment 1" }],
  });
});

test("app hybrid router wiring downgrades browser-ready stages to Python fallback until app client adapters are configured", async () => {
  const calls = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async (file) => {
        calls.push(["server-audio", file.name]);
        return { audioId: "server-audio" };
      },
      segmentAudio: async (audioId) => {
        calls.push(["server-vad", audioId]);
        return [];
      },
    },
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "browser", strategy: "web-audio-vad" },
      },
    },
  });

  const extraction = await router.runAudioExtraction({ name: "clip.mp4" });
  const segmentation = await router.runVadSegmentation(extraction.payload.audioId);

  assert.deepEqual(calls, [
    ["server-audio", "clip.mp4"],
    ["server-vad", "server-audio"],
  ]);
  assert.equal(extraction.runtime, "server-fallback");
  assert.equal(extraction.strategy, "ffmpeg.wasm");
  assert.equal(segmentation.runtime, "server-fallback");
  assert.equal(segmentation.strategy, "web-audio-vad");
});

test("app hybrid router wiring runs transcription through the Python transcription fallback adapter", async () => {
  const calls = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async () => ({ audioId: "audio-123" }),
      segmentAudio: async () => [],
      transcribeAudio: async ({ audioId, sourceLanguage, segments }, onProgress) => {
        calls.push(["transcribeAudio", audioId, sourceLanguage.code, segments.length]);
        onProgress({ stage: "transcribing", progress: 55 });
        return [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }];
      },
    },
    capabilityReport: {
      stages: {
        transcription: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });
  const progress = [];

  const result = await router.runTranscription(
    {
      audioId: "audio-123",
      sourceLanguage: { code: "fr", name: "French" },
      segments: [{ index: 1, start: 0, end: 1.5 }],
    },
    (job) => progress.push(job),
  );

  assert.deepEqual(calls, [["transcribeAudio", "audio-123", "fr", 1]]);
  assert.deepEqual(progress, [{ stage: "transcribing", progress: 55 }]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/transcribe-audio"],
    payload: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
  });
});

test("app hybrid router wiring runs subtitle generation through the Python subtitle job fallback", async () => {
  const calls = [];
  const jobUpdates = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async () => ({ audioId: "audio-123" }),
      segmentAudio: async () => [],
      createSubtitleJob: async ({ extractedAudio, sourceLanguage, targetLanguage, segments }) => {
        calls.push(["createSubtitleJob", extractedAudio.audioId, sourceLanguage.code, targetLanguage, segments.length]);
        return { jobId: "job-1" };
      },
      pollSubtitleJob: async (jobId, { onProgress }) => {
        calls.push(["pollSubtitleJob", jobId]);
        onProgress({ stage: "translating", translationProgress: 50 });
        return [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }];
      },
    },
    capabilityReport: {
      stages: {
        translation: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });

  const result = await router.runTranslation(
    {
      extractedAudio: { audioId: "audio-123" },
      sourceLanguage: { code: "fr", name: "French" },
      targetLanguage: "en",
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
      onJobCreated: (job) => jobUpdates.push(job),
    },
    (job) => jobUpdates.push(job),
  );

  assert.deepEqual(calls, [
    ["createSubtitleJob", "audio-123", "fr", "en", 1],
    ["pollSubtitleJob", "job-1"],
  ]);
  assert.deepEqual(jobUpdates, [
    { jobId: "job-1" },
    { stage: "translating", translationProgress: 50 },
  ]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
    payload: [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }],
  });
});
