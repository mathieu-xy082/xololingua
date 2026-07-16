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

test("client transcriber runs transcription through a configured Web Worker boundary", async () => {
  const workerInstances = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.messages = [];
      this.terminated = false;
      workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        this.onmessage({ data: { type: "progress", event: { stage: "loading-model", progress: 25 } } });
        this.onmessage({
          data: {
            type: "result",
            result: {
              language: "fr",
              segments: [{ index: 7, start: 0, end: 1, text: "Salut" }],
            },
          },
        });
      });
    }

    terminate() {
      this.terminated = true;
    }
  }
  const progress = [];
  const transcriber = createClientTranscriber({
    environment: { Worker: FakeWorker },
    workerUrl: "/workers/transcriber.js",
  });

  const result = await transcriber.transcribeAudio(
    {
      audio: { audioId: "audio-123", durationSeconds: 3 },
      segments: [{ index: 7, start: 0, end: 1 }],
      sourceLanguage: "fr",
    },
    (event) => progress.push(event),
  );

  assert.equal(workerInstances.length, 1);
  assert.equal(workerInstances[0].url, "/workers/transcriber.js");
  assert.deepEqual(workerInstances[0].options, { type: "module" });
  assert.deepEqual(workerInstances[0].messages, [{
    type: "transcribe",
    request: {
      audio: { audioId: "audio-123", durationSeconds: 3 },
      segments: [{ index: 7, start: 0, end: 1 }],
      sourceLanguage: "fr",
    },
  }]);
  assert.equal(workerInstances[0].terminated, true);
  assert.deepEqual(progress, [{ stage: "loading-model", progress: 25 }]);
  assert.deepEqual(result, {
    strategy: "transformers.js",
    language: "fr",
    segments: [{ index: 7, start: 0, end: 1, text: "Salut" }],
  });
});

test("client transcriber maps worker progress into bounded transcription progress events", async () => {
  const transformerWorker = async (request, onProgress) => {
    onProgress(0.25);
    onProgress({ progress: 150 });
    onProgress({ stage: "loading-model", progress: 40 });
    return { segments: [] };
  };
  const progress = [];
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker,
  });

  await transcriber.transcribeAudio(
    {
      audio: { pcm: new Float32Array([0.1]), sampleRate: 16000, channelCount: 1 },
      segments: [],
      sourceLanguage: "auto",
    },
    (event) => progress.push(event),
  );

  assert.deepEqual(progress, [
    { stage: "transcribing", progress: 25 },
    { stage: "transcribing", progress: 100 },
    { stage: "loading-model", progress: 40 },
  ]);
});

test("client transcriber rejects audio beyond the configured browser duration limit", async () => {
  let workerCalled = false;
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker: async () => {
      workerCalled = true;
      return { segments: [] };
    },
    maxDurationSeconds: 10,
  });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: {
        pcm: new Float32Array([0.1, -0.1]),
        sampleRate: 16000,
        channelCount: 1,
        durationSeconds: 12,
      },
      segments: [],
      sourceLanguage: "auto",
    }),
    /Browser transcription limit exceeded: audio duration 12s is greater than the 10s limit\./,
  );
  assert.equal(workerCalled, false);
});

test("client transcriber rejects audio beyond the configured browser size limit", async () => {
  let workerCalled = false;
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker: async () => {
      workerCalled = true;
      return { segments: [] };
    },
    maxAudioBytes: 4,
  });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: {
        pcm: new Float32Array([0.1, -0.1]),
        sampleRate: 16000,
        channelCount: 1,
        sizeBytes: 8,
      },
      segments: [],
      sourceLanguage: "auto",
    }),
    /Browser transcription limit exceeded: audio size 8 bytes is greater than the 4 bytes limit\./,
  );
  assert.equal(workerCalled, false);
});

test("client transcriber rejects segment lists beyond the configured browser limit", async () => {
  let workerCalled = false;
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker: async () => {
      workerCalled = true;
      return { segments: [] };
    },
    maxSegments: 1,
  });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: {
        pcm: new Float32Array([0.1, -0.1]),
        sampleRate: 16000,
        channelCount: 1,
      },
      segments: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ],
      sourceLanguage: "auto",
    }),
    /Browser transcription limit exceeded: 2 segments is greater than the 1 segment limit\./,
  );
  assert.equal(workerCalled, false);
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
