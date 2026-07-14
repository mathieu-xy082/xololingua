import test from "node:test";
import assert from "node:assert/strict";

import { createAppClientAdapters, createAppHybridPipelineRouter } from "../frontend/app_hybrid_router_wiring.js";

test("app client adapters expose browser audio extraction for the global E2E guard", async () => {
  const calls = [];
  const adapters = createAppClientAdapters({
    clientAudioExtractor: {
      extractAudio: async (file, onProgress) => {
        calls.push([file.name]);
        onProgress(100);
        return { audioId: "browser-audio", audioFileName: "clip.wav", audioSizeBytes: 2048 };
      },
    },
  });
  const progress = [];

  const payload = await adapters.audioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["clip.mp4"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(payload, { audioId: "browser-audio", audioFileName: "clip.wav", audioSizeBytes: 2048 });
});

test("app client adapters expose browser VAD segmentation for the strict E2E guard", async () => {
  const calls = [];
  const adapters = createAppClientAdapters({
    clientVadSegmenter: {
      segmentAudio: async (audio, onProgress) => {
        calls.push([audio.audioId]);
        onProgress(100);
        return {
          stage: "vad",
          runtime: "browser",
          strategy: "vad-web",
          payload: { segments: [{ start: 0.1, end: 0.9 }] },
          metadata: { diagnostics: { source: "test-vad" } },
        };
      },
    },
  });
  const progress = [];

  const payload = await adapters.vad({ audioId: "browser-audio" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["browser-audio"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(payload, {
    stage: "vad",
    runtime: "browser",
    strategy: "vad-web",
    payload: { segments: [{ start: 0.1, end: 0.9 }] },
    metadata: { diagnostics: { source: "test-vad" } },
  });
});

test("app client adapters expose browser transcription for the hybrid router", async () => {
  const calls = [];
  const adapters = createAppClientAdapters({
    clientTranscriber: {
      transcribeAudio: async (request, onProgress) => {
        calls.push([request.audioId, request.sourceLanguage.code, request.segments.length]);
        onProgress({ stage: "transcribing", progress: 70 });
        return [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }];
      },
    },
  });
  const progress = [];

  const payload = await adapters.transcription(
    {
      audioId: "audio-123",
      sourceLanguage: { code: "fr", name: "French" },
      segments: [{ index: 1, start: 0, end: 1.5 }],
    },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [["audio-123", "fr", 1]]);
  assert.deepEqual(progress, [{ stage: "transcribing", progress: 70 }]);
  assert.deepEqual(payload, [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }]);
});

test("app client adapters expose browser translation for the hybrid router", async () => {
  const calls = [];
  const adapters = createAppClientAdapters({
    clientTranslator: {
      translateSegments: async (request, onProgress) => {
        calls.push([request.sourceLanguage.code, request.targetLanguage, request.segments.length]);
        onProgress({ stage: "translating", progress: 80 });
        return [{ index: 1, start: 0, end: 1.5, text: "Hello" }];
      },
    },
  });
  const progress = [];

  const payload = await adapters.translation(
    {
      sourceLanguage: { code: "fr", name: "French" },
      targetLanguage: "en",
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
    },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [["fr", "en", 1]]);
  assert.deepEqual(progress, [{ stage: "translating", progress: 80 }]);
  assert.deepEqual(payload, [{ index: 1, start: 0, end: 1.5, text: "Hello" }]);
});

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
    stage: "audioExtraction",
    runtime: "server-fallback",
    strategy: "python-backend",
    payload: {
      audioId: "audio-123",
      audioBlob: null,
      storage: "server",
      mimeType: null,
      sampleRateHz: null,
      durationSeconds: null,
    },
    metadata: {
      audioFileName: "clip.wav",
      audioSizeBytes: 4096,
      fallbackEndpoints: ["POST /api/extract-audio"],
    },
  });
  assert.deepEqual(segmentation, {
    stage: "vad",
    runtime: "server-fallback",
    strategy: "python-backend",
    payload: {
      segments: [{ index: 1, start: 0, end: 1.5, text: "Speech segment 1" }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/segment-audio"],
    },
  });
});

test("app hybrid router wiring registers browser WAV before Python VAD fallback when audio has no server id", async () => {
  const calls = [];
  const backendClient = {
    registerAudio: async (audio, onProgress) => {
      calls.push(["registerAudio", audio.audioFileName]);
      onProgress(25);
      return { audioId: "registered-audio", audioFileName: "registered.wav" };
    },
    segmentAudio: async (audioId, onProgress) => {
      calls.push(["segmentAudio", audioId]);
      onProgress(100);
      return [{ index: 1, start: 0, end: 1.5 }];
    },
  };
  const router = createAppHybridPipelineRouter({
    backendClient,
    capabilityReport: {
      stages: {
        vad: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });
  const progress = [];

  const segmentation = await router.runVadSegmentation(
    { audioBlob: new Blob([new Uint8Array([1])], { type: "audio/wav" }), audioFileName: "browser.wav" },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [
    ["registerAudio", "browser.wav"],
    ["segmentAudio", "registered-audio"],
  ]);
  assert.deepEqual(progress, [25, 100]);
  assert.equal(segmentation.runtime, "server-fallback");
  assert.deepEqual(segmentation.payload.segments, [{ index: 1, start: 0, end: 1.5 }]);
});

test("app hybrid router wiring uses the configured browser audio extraction adapter when audio extraction is browser-ready", async () => {
  const calls = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async (file) => {
        calls.push(["server-audio", file.name]);
        return { audioId: "server-audio" };
      },
    },
    clientAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["browser-audio", file.name]);
        onProgress(100);
        return { audioId: "browser-audio", audioFileName: "clip.wav", audioSizeBytes: 4096 };
      },
    },
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
      },
    },
  });
  const progress = [];

  const extraction = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["browser-audio", "clip.mp4"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(extraction, {
    stage: "audioExtraction",
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: {
      audioId: "browser-audio",
      audioBlob: null,
      storage: "server",
      mimeType: null,
      sampleRateHz: null,
      durationSeconds: null,
    },
    metadata: {
      audioFileName: "clip.wav",
      audioSizeBytes: 4096,
    },
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
  assert.equal(
    extraction.metadata.browserFailureReason,
    "Browser audio extraction adapter is not configured in app.js; using Python backend fallback.",
  );
  assert.equal(segmentation.runtime, "server-fallback");
  assert.equal(segmentation.strategy, "web-audio-vad");
  assert.equal(
    segmentation.metadata.browserFailureReason,
    "Browser VAD / segmentation adapter is not configured in app.js; using Python backend fallback.",
  );
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
    stage: "transcription",
    runtime: "server-fallback",
    strategy: "python-backend",
    payload: {
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/transcribe-audio", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
    },
  });
});

test("app hybrid router wiring translates already-transcribed segments through the Python translation fallback", async () => {
  const calls = [];
  const jobUpdates = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async () => ({ audioId: "audio-123" }),
      segmentAudio: async () => [],
      translateSegments: async ({ sourceLanguage, targetLanguage, segments }, onProgress) => {
        calls.push(["translateSegments", sourceLanguage.code, targetLanguage, segments.length]);
        onProgress({ stage: "translating", progress: 100 });
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

  assert.deepEqual(calls, [["translateSegments", "fr", "en", 1]]);
  assert.deepEqual(jobUpdates, [{ stage: "translating", progress: 100 }]);
  assert.deepEqual(result, {
    stage: "translation",
    runtime: "server-fallback",
    strategy: "python-backend",
    payload: {
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/translate-segments"],
    },
  });
});

test("app hybrid router full pipeline passes extracted audio into the Python subtitle fallback", async () => {
  const calls = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async (file) => {
        calls.push(["extractAudio", file.name]);
        return { audioId: "audio-123", audioFileName: "clip.wav" };
      },
      segmentAudio: async (audioId) => {
        calls.push(["segmentAudio", audioId]);
        return [{ index: 1, start: 0, end: 1.5 }];
      },
      transcribeAudio: async ({ audioId, sourceLanguage, segments }) => {
        calls.push(["transcribeAudio", audioId, sourceLanguage.code, segments.length]);
        return [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }];
      },
      createSubtitleJob: async ({ extractedAudio, sourceLanguage, targetLanguage, segments }) => {
        calls.push(["createSubtitleJob", extractedAudio.audioId, sourceLanguage.code, targetLanguage, segments.length]);
        return { jobId: "job-1" };
      },
      pollSubtitleJob: async (jobId) => {
        calls.push(["pollSubtitleJob", jobId]);
        return [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }];
      },
    },
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "python-backend" },
        vad: { runtime: "server-fallback", strategy: "python-backend" },
        transcription: { runtime: "server-fallback", strategy: "python-backend" },
        translation: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });

  const result = await router.runSubtitlePipeline({
    file: { name: "clip.mp4" },
    sourceLanguage: { code: "fr", name: "French" },
    targetLanguage: "en",
  });

  assert.deepEqual(calls, [
    ["extractAudio", "clip.mp4"],
    ["segmentAudio", "audio-123"],
    ["transcribeAudio", "audio-123", "fr", 1],
    ["createSubtitleJob", "audio-123", "fr", "en", 1],
    ["pollSubtitleJob", "job-1"],
  ]);
  assert.equal(result.translation.runtime, "server-fallback");
  assert.deepEqual(result.translatedSegments, [
    { index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" },
  ]);
});
