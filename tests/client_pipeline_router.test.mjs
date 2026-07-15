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
    stage: "audioExtraction",
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: {
      audioId: "browser-audio",
      audioBlob: null,
      storage: "server",
      mimeType: null,
      sampleRateHz: 16000,
      durationSeconds: null,
    },
    metadata: {},
  });
});

test("hybrid pipeline router falls back to the Python audio endpoint when browser extraction fails at runtime", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
      },
    },
    clientAdapters: {
      audioExtraction: async (file) => {
        calls.push(["client", file.name]);
        throw new Error("ffmpeg.wasm failed to load");
      },
    },
    serverAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["server", file.name]);
        onProgress(45);
        return { audioId: "server-audio", audioFileName: "clip.wav" };
      },
    },
  });
  const progress = [];

  const result = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["client", "clip.mp4"], ["server", "clip.mp4"]]);
  assert.deepEqual(progress, [45]);
  assert.deepEqual(result, {
    stage: "audioExtraction",
    runtime: "server-fallback",
    strategy: "ffmpeg.wasm",
    payload: {
      audioId: "server-audio",
      audioBlob: null,
      storage: "server",
      mimeType: null,
      sampleRateHz: null,
      durationSeconds: null,
    },
    metadata: {
      audioFileName: "clip.wav",
      fallbackEndpoints: ["POST /api/extract-audio"],
      browserFailureReason: "ffmpeg.wasm failed to load",
    },
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
    stage: "audioExtraction",
    runtime: "server-fallback",
    strategy: "unavailable",
    payload: {
      audioId: "server-audio",
      audioBlob: null,
      storage: "server",
      mimeType: null,
      sampleRateHz: null,
      durationSeconds: null,
    },
    metadata: {
      audioFileName: "clip.wav",
      fallbackEndpoints: ["POST /api/extract-audio"],
    },
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
    stage: "vad",
    runtime: "server-fallback",
    strategy: "unavailable",
    payload: {
      segments: [{ start: 0, end: 1.5 }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/segment-audio"],
    },
  });
});

test("hybrid pipeline router falls back to the Python transcription endpoint when browser transcription is unavailable", async () => {
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
    stage: "transcription",
    runtime: "server-fallback",
    strategy: "unavailable",
    payload: {
      segments: [{ index: 1, text: "bonjour" }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/transcribe-audio"],
    },
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
    stage: "translation",
    runtime: "server-fallback",
    strategy: "unavailable",
    payload: {
      segments: [{ index: 1, translatedText: "Hello" }],
    },
    metadata: {
      fallbackEndpoints: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
    },
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

test("hybrid pipeline router runs a demo subtitle pipeline with explicit stage runtimes", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "server-fallback", strategy: "unavailable" },
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
        translation: { runtime: "browser", strategy: "local-transformers.js" },
      },
    },
    clientAdapters: {
      audioExtraction: async (file) => {
        calls.push(["browser-audio", file.name]);
        return { audioId: "browser-audio" };
      },
      translation: async (request) => {
        calls.push(["browser-translation", request.sourceLanguage, request.targetLanguage]);
        return request.segments.map((segment) => ({
          ...segment,
          translatedText: `EN:${segment.text}`,
        }));
      },
    },
    serverAdapters: {
      vad: async (audioId) => {
        calls.push(["server-vad", audioId]);
        return [{ index: 1, start: 0, end: 1.5 }];
      },
      transcription: async (request) => {
        calls.push(["server-transcription", request.audioId, request.sourceLanguage]);
        return request.segments.map((segment) => ({ ...segment, text: "Bonjour" }));
      },
    },
  });

  const result = await router.runSubtitlePipeline({
    file: { name: "clip.mp4" },
    sourceLanguage: "fr",
    targetLanguage: "en",
  });

  assert.deepEqual(calls, [
    ["browser-audio", "clip.mp4"],
    ["server-vad", "browser-audio"],
    ["server-transcription", "browser-audio", "fr"],
    ["browser-translation", "fr", "en"],
  ]);
  assert.deepEqual(result.stageRuntimes, {
    audioExtraction: "browser",
    vad: "server-fallback",
    transcription: "server-fallback",
    translation: "browser",
  });
  assert.deepEqual(result.translatedSegments, [
    { index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "EN:Bonjour" },
  ]);
});

test("hybrid pipeline router returns formatted SRT text when a demo pipeline formatter is configured", async () => {
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "server-fallback", strategy: "unavailable" },
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
        translation: { runtime: "browser", strategy: "local-transformers.js" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => ({ audioId: "browser-audio" }),
      translation: async ({ segments }) => segments.map((segment) => ({
        ...segment,
        translatedText: `EN:${segment.text}`,
      })),
    },
    serverAdapters: {
      vad: async () => [{ index: 1, start: 0, end: 1.5 }],
      transcription: async ({ segments }) => segments.map((segment) => ({ ...segment, text: "Bonjour" })),
    },
    srtFormatter: (segments) => segments
      .map((segment) => `${segment.index}\n${segment.start} --> ${segment.end}\n${segment.translatedText}`)
      .join("\n\n"),
  });

  const result = await router.runSubtitlePipeline({
    file: { name: "clip.mp4" },
    sourceLanguage: "fr",
    targetLanguage: "en",
  });

  assert.equal(result.srtText, "1\n0 --> 1.5\nEN:Bonjour");
});

test("hybrid pipeline router summarizes Python fallback stages after a demo subtitle run", async () => {
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "server-fallback", strategy: "unavailable" },
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
        translation: { runtime: "browser", strategy: "local-transformers.js" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => ({ audioId: "browser-audio" }),
      translation: async ({ segments }) => segments,
    },
    serverAdapters: {
      vad: async () => [{ index: 1, start: 0, end: 1.5 }],
      transcription: async ({ segments }) => segments.map((segment) => ({ ...segment, text: "Bonjour" })),
    },
  });

  const result = await router.runSubtitlePipeline({
    file: { name: "clip.mp4" },
    sourceLanguage: "fr",
    targetLanguage: "en",
  });

  assert.deepEqual(result.serverFallbackStages, [
    {
      stage: "vad",
      endpoints: ["POST /api/segment-audio"],
    },
    {
      stage: "transcription",
      endpoints: ["POST /api/transcribe-audio"],
    },
  ]);
});

test("hybrid pipeline router emits ordered user stage reports as each subtitle stage completes", async () => {
  const stageEvents = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "server-fallback", strategy: "unavailable" },
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
        translation: { runtime: "browser", strategy: "local-transformers.js" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => ({ audioId: "browser-audio" }),
      translation: async ({ segments }) => segments.map((segment) => ({
        ...segment,
        translatedText: `EN:${segment.text}`,
      })),
    },
    serverAdapters: {
      vad: async () => [{ index: 1, start: 0, end: 1.5 }],
      transcription: async ({ segments }) => segments.map((segment) => ({ ...segment, text: "Bonjour" })),
    },
  });

  await router.runSubtitlePipeline(
    {
      file: { name: "clip.mp4" },
      sourceLanguage: "fr",
      targetLanguage: "en",
    },
    {
      onStageComplete: (stageReport) => stageEvents.push(stageReport),
    },
  );

  assert.deepEqual(stageEvents, [
    {
      stage: "audioExtraction",
      label: "Audio extraction",
      runtime: "browser",
      runtimeLabel: "Browser",
      strategy: "ffmpeg.wasm",
      status: "completed",
      fallbackEndpoints: [],
    },
    {
      stage: "vad",
      label: "VAD / segmentation",
      runtime: "server-fallback",
      runtimeLabel: "Python fallback",
      strategy: "unavailable",
      status: "completed-via-fallback",
      fallbackEndpoints: ["POST /api/segment-audio"],
    },
    {
      stage: "transcription",
      label: "Transcription",
      runtime: "server-fallback",
      runtimeLabel: "Python fallback",
      strategy: "unavailable",
      status: "completed-via-fallback",
      fallbackEndpoints: ["POST /api/transcribe-audio"],
    },
    {
      stage: "translation",
      label: "Translation",
      runtime: "browser",
      runtimeLabel: "Browser",
      strategy: "local-transformers.js",
      status: "completed",
      fallbackEndpoints: [],
    },
  ]);
});

test("hybrid pipeline router returns an ordered user stage report with Python fallback details", async () => {
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "browser", strategy: "web-audio-vad" },
        transcription: { runtime: "server-fallback", strategy: "unavailable" },
        translation: { runtime: "browser", strategy: "local-transformers.js" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => ({ audioId: "browser-audio" }),
      vad: async () => {
        throw new Error("VAD model unavailable");
      },
      translation: async ({ segments }) => segments.map((segment) => ({
        ...segment,
        translatedText: `EN:${segment.text}`,
      })),
    },
    serverAdapters: {
      vad: async () => [{ index: 1, start: 0, end: 1.5 }],
      transcription: async ({ segments }) => segments.map((segment) => ({ ...segment, text: "Bonjour" })),
    },
  });

  const result = await router.runSubtitlePipeline({
    file: { name: "clip.mp4" },
    sourceLanguage: "fr",
    targetLanguage: "en",
  });

  assert.deepEqual(result.userStageReport, [
    {
      stage: "audioExtraction",
      label: "Audio extraction",
      runtime: "browser",
      runtimeLabel: "Browser",
      strategy: "ffmpeg.wasm",
      status: "completed",
      fallbackEndpoints: [],
    },
    {
      stage: "vad",
      label: "VAD / segmentation",
      runtime: "server-fallback",
      runtimeLabel: "Python fallback",
      strategy: "web-audio-vad",
      status: "completed-via-fallback",
      fallbackEndpoints: ["POST /api/segment-audio"],
      browserFailureReason: "VAD model unavailable",
    },
    {
      stage: "transcription",
      label: "Transcription",
      runtime: "server-fallback",
      runtimeLabel: "Python fallback",
      strategy: "unavailable",
      status: "completed-via-fallback",
      fallbackEndpoints: ["POST /api/transcribe-audio"],
    },
    {
      stage: "translation",
      label: "Translation",
      runtime: "browser",
      runtimeLabel: "Browser",
      strategy: "local-transformers.js",
      status: "completed",
      fallbackEndpoints: [],
    },
  ]);
});
