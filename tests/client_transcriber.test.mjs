import test from "node:test";
import assert from "node:assert/strict";

import {
  createClientTranscriber,
  detectClientTranscriptionCapabilities,
} from "../frontend/client_transcriber.js";

test("detectClientTranscriptionCapabilities reports transformers.js worker readiness", () => {
  const capabilities = detectClientTranscriptionCapabilities({
    Worker: function Worker() {},
    navigator: { gpu: {} },
    transformers: { pipeline: function pipeline() {} },
  });

  assert.deepEqual(capabilities, {
    transformersJs: true,
    webGpu: true,
    strategy: "transformers.js",
  });
});

test("client transcriber delegates PCM audio to an injected transformers.js worker", async () => {
  const calls = [];
  const transformerWorker = async (request, onProgress) => {
    calls.push(request);
    onProgress({ stage: "loading-model", progress: 40 });
    onProgress({ stage: "transcribing", progress: 100 });
    return {
      language: "fr",
      segments: [
        { start: 0.25, end: 1.5, text: "Bonjour" },
        { start: 2, end: 3.25, text: "le monde" },
      ],
    };
  };
  const audio = {
    pcm: new Float32Array([0.1, -0.1]),
    sampleRate: 16000,
    channelCount: 1,
  };
  const segments = [
    { start: 0.25, end: 1.5 },
    { start: 2, end: 3.25 },
  ];
  const progress = [];
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker,
  });

  const result = await transcriber.transcribeAudio(
    { audio, segments, sourceLanguage: "auto" },
    (event) => progress.push(event),
  );

  assert.deepEqual(calls, [{ audio, segments, sourceLanguage: "auto" }]);
  assert.deepEqual(progress, [
    { stage: "loading-model", progress: 40 },
    { stage: "transcribing", progress: 100 },
  ]);
  assert.deepEqual(result, {
    strategy: "transformers.js",
    language: "fr",
    segments: [
      { index: 1, start: 0.25, end: 1.5, text: "Bonjour" },
      { index: 2, start: 2, end: 3.25, text: "le monde" },
    ],
  });
});

test("client transcriber fails explicitly when no local transcription path is available", async () => {
  const transcriber = createClientTranscriber({ environment: {} });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: { pcm: new Float32Array(), sampleRate: 16000, channelCount: 1 },
      segments: [],
      sourceLanguage: "auto",
    }),
    /Browser transcription requires transformers\.js in a Web Worker or a configured transcription fallback\./,
  );
});
