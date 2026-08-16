import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("detectClientTranscriptionCapabilities treats a module worker as the local ASR runtime boundary", () => {
  const capabilities = detectClientTranscriptionCapabilities({
    Worker: function Worker() {},
    navigator: {},
  });

  assert.deepEqual(capabilities, {
    transformersJs: true,
    webGpu: false,
    strategy: "transformers.js",
  });
});

test("transcription worker preserves VAD windows instead of replacing them with Whisper chunks", () => {
  const workerSource = readFileSync(new URL("../frontend/transcription_worker.js", import.meta.url), "utf-8");

  assert.match(workerSource, /transcribeVadSegments/);
  assert.match(workerSource, /slicePcmForSegment/);
  assert.match(workerSource, /segments\.map\(async|for \(const .*segments/);
  assert.match(workerSource, /start:\s*Number\(segment\.start/);
  assert.match(workerSource, /end:\s*Number\(segment\.end/);
  assert.doesNotMatch(workerSource, /chunks\.length > 0\s*\?\s*chunks\.map/);
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

test("client transcriber reuses one ASR worker for warmup and transcription", async () => {
  const workerInstances = [];
  class WarmupWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.messages = [];
      this.terminated = false;
      workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
      if (message.type === "warmup") {
        queueMicrotask(() => {
          this.onmessage({ data: { type: "progress", event: { stage: "asr-warmup", progress: 50 } } });
          this.onmessage({ data: { type: "warmup-complete", metadata: { modelId: "Xenova/whisper-tiny", warmed: true } } });
        });
        return;
      }
      queueMicrotask(() => {
        this.onmessage({
          data: {
            type: "result",
            result: {
              language: "fr",
              segments: [{ index: 1, start: 0, end: 1, text: "Bonjour" }],
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
    environment: { Worker: WarmupWorker },
    workerUrl: "/frontend/transcription_worker.js",
    modelId: "Xenova/whisper-tiny",
    warmupTimeoutMs: 100,
  });

  const result = await transcriber.transcribeAudio(
    {
      audio: { audioId: "audio-123", durationSeconds: 3 },
      segments: [{ index: 1, start: 0, end: 1 }],
      sourceLanguage: "fr",
    },
    (event) => progress.push(event),
  );

  assert.equal(workerInstances.length, 1);
  assert.deepEqual(workerInstances[0].messages, [
    { type: "warmup", request: { modelId: "Xenova/whisper-tiny", sampleSeconds: 1, sourceLanguage: "fr" } },
    {
      type: "transcribe",
      request: {
        audio: { audioId: "audio-123", durationSeconds: 3 },
        segments: [{ index: 1, start: 0, end: 1 }],
        sourceLanguage: "fr",
        modelId: "Xenova/whisper-tiny",
      },
    },
  ]);
  assert.equal(workerInstances[0].terminated, true);
  assert.deepEqual(progress, [{ stage: "asr-warmup", progress: 50 }]);
  assert.deepEqual(result, {
    strategy: "whisper-transformers.js",
    language: "fr",
    segments: [{ index: 1, start: 0, end: 1, text: "Bonjour" }],
    metadata: {
      modelId: "Xenova/whisper-tiny",
      warmup: { modelId: "Xenova/whisper-tiny", warmed: true },
      warmupTimeoutMs: 100,
    },
  });
});

test("client transcriber creates a fresh persistent worker session for the next purged job", async () => {
  const workerInstances = [];
  class ReusableWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        if (message.type === "warmup") {
          this.onmessage({ data: { type: "warmup-complete", metadata: { warmed: true } } });
        } else {
          this.onmessage({ data: { type: "result", result: { segments: [] } } });
        }
      });
    }

    terminate() {
      this.terminated = true;
    }
  }
  const transcriber = createClientTranscriber({
    environment: { Worker: ReusableWorker },
    workerUrl: "/frontend/transcription_worker.js",
    modelId: "Xenova/whisper-base",
    purgeAfterUse: true,
  });
  const request = {
    audio: { pcm: new Float32Array([0]), sampleRate: 16000 },
    segments: [],
    sourceLanguage: "fr",
  };

  await transcriber.transcribeAudio(request);
  await transcriber.transcribeAudio(request);

  assert.equal(workerInstances.length, 2);
  assert.deepEqual(workerInstances.map((worker) => worker.messages.map((message) => message.type)), [
    ["warmup", "transcribe"],
    ["warmup", "transcribe"],
  ]);
  assert.ok(workerInstances.every((worker) => worker.terminated));
});

test("client transcriber fails fast when ASR warmup times out", async () => {
  const workerInstances = [];
  class StalledWarmupWorker {
    constructor() {
      this.terminated = false;
      workerInstances.push(this);
    }

    postMessage() {}

    terminate() {
      this.terminated = true;
    }
  }
  const transcriber = createClientTranscriber({
    environment: { Worker: StalledWarmupWorker },
    workerUrl: "/frontend/transcription_worker.js",
    modelId: "Xenova/whisper-tiny",
    warmupTimeoutMs: 1,
  });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: { audioId: "audio-123", durationSeconds: 3 },
      segments: [],
      sourceLanguage: "fr",
    }),
    /Browser transcription warmup timed out after 1ms\./,
  );
  assert.equal(workerInstances.length, 1);
  assert.equal(workerInstances[0].terminated, true);
});

test("client transcriber rejects a stalled configured Web Worker with an explicit timeout", async () => {
  const workerInstances = [];
  class StalledWorker {
    constructor() {
      this.terminated = false;
      workerInstances.push(this);
    }

    postMessage() {}

    terminate() {
      this.terminated = true;
    }
  }
  const transcriber = createClientTranscriber({
    environment: { Worker: StalledWorker },
    workerUrl: "/workers/transcriber.js",
    maxWorkerResponseMs: 1,
  });

  await assert.rejects(
    () => transcriber.transcribeAudio({
      audio: { audioId: "audio-123", durationSeconds: 3 },
      segments: [],
      sourceLanguage: "fr",
    }),
    /Browser transcription worker timed out after 1ms\./,
  );
  assert.equal(workerInstances.length, 1);
  assert.equal(workerInstances[0].terminated, true);
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

test("client transcriber maps loaded and total worker progress into subtitle progress", async () => {
  const transformerWorker = async (request, onProgress) => {
    onProgress({ status: "progress", loaded: 3, total: 12 });
    onProgress({ stage: "loading-model", loaded: 9, total: 12 });
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
    { status: "progress", loaded: 3, total: 12, stage: "transcribing", progress: 25 },
    { stage: "loading-model", loaded: 9, total: 12, progress: 75 },
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
