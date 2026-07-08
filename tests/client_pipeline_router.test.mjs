import test from "node:test";
import assert from "node:assert/strict";

import { createHybridPipelineRouter } from "../frontend/client_pipeline_router.js";

test("hybrid pipeline router runs browser audio extraction when the stage is browser-ready", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
      },
    },
    clientAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["client", file.name]);
        onProgress(100);
        return { audioId: "browser-audio", sampleRate: 16000 };
      },
    },
    serverAdapters: {
      audioExtraction: async () => {
        calls.push(["server"]);
        return { audioId: "server-audio" };
      },
    },
  });
  const progress = [];

  const result = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["client", "clip.mp4"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(result, {
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: { audioId: "browser-audio", sampleRate: 16000 },
  });
});

test("hybrid pipeline router falls back to the Python audio endpoint when browser extraction is unavailable", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => {
        calls.push(["client"]);
        return { audioId: "browser-audio" };
      },
    },
    serverAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["server", file.name]);
        onProgress(35);
        return { audioId: "server-audio", audioFileName: "clip.wav" };
      },
    },
  });
  const progress = [];

  const result = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["server", "clip.mp4"]]);
  assert.deepEqual(progress, [35]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "unavailable",
    fallbackEndpoint: "POST /api/extract-audio",
    payload: { audioId: "server-audio", audioFileName: "clip.wav" },
  });
});

test("hybrid pipeline router falls back to the Python segmentation endpoint when browser VAD is unavailable", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        vad: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {
      vad: async () => {
        calls.push(["client"]);
        return [{ start: 0, end: 1 }];
      },
    },
    serverAdapters: {
      vad: async (audioId, onProgress) => {
        calls.push(["server", audioId]);
        onProgress(100);
        return [{ start: 0, end: 1.5 }];
      },
    },
  });
  const progress = [];

  const result = await router.runVadSegmentation("audio-123", (value) => progress.push(value));

  assert.deepEqual(calls, [["server", "audio-123"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "unavailable",
    fallbackEndpoint: "POST /api/segment-audio",
    payload: [{ start: 0, end: 1.5 }],
  });
});

test("hybrid pipeline router falls back to the Python subtitle job endpoint when browser transcription is unavailable", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {
      transcription: async () => {
        calls.push(["client"]);
        return [{ index: 1, text: "bonjour" }];
      },
    },
    serverAdapters: {
      transcription: async (payload, onProgress) => {
        calls.push(["server", payload.audioId, payload.sourceLanguage]);
        onProgress({ transcriptionProgress: 100 });
        return [{ index: 1, text: "bonjour" }];
      },
    },
  });
  const progress = [];

  const result = await router.runTranscription(
    { audioId: "audio-123", sourceLanguage: "fr", segments: [{ index: 1, start: 0, end: 1.5 }] },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [["server", "audio-123", "fr"]]);
  assert.deepEqual(progress, [{ transcriptionProgress: 100 }]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "unavailable",
    fallbackEndpoint: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
    payload: [{ index: 1, text: "bonjour" }],
  });
});

test("hybrid pipeline router falls back to the Python subtitle job endpoint when browser translation is unavailable", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        translation: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {
      translation: async () => {
        calls.push(["client"]);
        return [{ index: 1, translatedText: "Hello" }];
      },
    },
    serverAdapters: {
      translation: async (payload, onProgress) => {
        calls.push(["server", payload.sourceLanguage, payload.targetLanguage]);
        onProgress({ translationProgress: 100 });
        return [{ index: 1, translatedText: "Hello" }];
      },
    },
  });
  const progress = [];

  const result = await router.runTranslation(
    {
      sourceLanguage: "fr",
      targetLanguage: "en",
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
    },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [["server", "fr", "en"]]);
  assert.deepEqual(progress, [{ translationProgress: 100 }]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "unavailable",
    fallbackEndpoint: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
    payload: [{ index: 1, translatedText: "Hello" }],
  });
});

test("hybrid pipeline router fails explicitly when the selected adapter is missing", async () => {
  const browserRouter = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "webcodecs" },
      },
    },
    clientAdapters: {},
    serverAdapters: {},
  });
  const fallbackRouter = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        vad: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {},
    serverAdapters: {},
  });

  await assert.rejects(
    () => browserRouter.runAudioExtraction({ name: "clip.mp4" }),
    /Browser audio extraction adapter is not configured\./,
  );
  await assert.rejects(
    () => fallbackRouter.runVadSegmentation("audio-123"),
    /Python fallback VAD segmentation adapter is not configured\./,
  );
});
