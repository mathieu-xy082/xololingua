import test from "node:test";
import assert from "node:assert/strict";

import {
  createClientTranslator,
  detectClientTranslationCapabilities,
} from "../frontend/client_translator.js";

test("detectClientTranslationCapabilities reports local transformers.js translation readiness", () => {
  const capabilities = detectClientTranslationCapabilities({
    Worker: function Worker() {},
    transformers: { pipeline: function pipeline() {} },
  });

  assert.deepEqual(capabilities, {
    localTransformersJs: true,
    cloudProvider: false,
    strategy: "local-transformers.js",
  });
});

test("client translator delegates segment translation to an injected local transformers.js worker", async () => {
  const calls = [];
  const localTranslatorWorker = async (request, onProgress) => {
    calls.push(request);
    onProgress({ stage: "loading-model", progress: 50 });
    onProgress({ stage: "translating", progress: 100 });
    return {
      segments: [
        { index: 1, text: "Hello" },
        { index: 2, text: "world" },
      ],
    };
  };
  const sourceSegments = [
    { index: 1, start: 0.25, end: 1.5, text: "Bonjour" },
    { index: 2, start: 2, end: 3.25, text: "le monde" },
  ];
  const progress = [];
  const translator = createClientTranslator({
    environment: {},
    localTranslatorWorker,
  });

  const result = await translator.translateSegments(
    { segments: sourceSegments, sourceLanguage: "fr", targetLanguage: "en" },
    (event) => progress.push(event),
  );

  assert.deepEqual(calls, [{ segments: sourceSegments, sourceLanguage: "fr", targetLanguage: "en" }]);
  assert.deepEqual(progress, [
    { stage: "loading-model", progress: 50 },
    { stage: "translating", progress: 100 },
  ]);
  assert.deepEqual(result, {
    strategy: "local-transformers.js",
    segments: [
      { index: 1, start: 0.25, end: 1.5, text: "Hello" },
      { index: 2, start: 2, end: 3.25, text: "world" },
    ],
  });
});

test("client translator runs local translation through a configured Web Worker boundary", async () => {
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
        this.onmessage({ data: { type: "progress", event: { stage: "loading-model", progress: 35 } } });
        this.onmessage({
          data: {
            type: "result",
            result: {
              segments: [{ index: 3, text: "Hello" }],
            },
          },
        });
      });
    }

    terminate() {
      this.terminated = true;
    }
  }
  const sourceSegments = [{ index: 3, start: 0, end: 1, text: "Bonjour" }];
  const progress = [];
  const translator = createClientTranslator({
    environment: { Worker: FakeWorker },
    workerUrl: "/workers/translator.js",
  });

  const result = await translator.translateSegments(
    { segments: sourceSegments, sourceLanguage: "fr", targetLanguage: "en" },
    (event) => progress.push(event),
  );

  assert.equal(workerInstances.length, 1);
  assert.equal(workerInstances[0].url, "/workers/translator.js");
  assert.deepEqual(workerInstances[0].options, { type: "module" });
  assert.deepEqual(workerInstances[0].messages, [{
    type: "translate",
    request: { segments: sourceSegments, sourceLanguage: "fr", targetLanguage: "en" },
  }]);
  assert.equal(workerInstances[0].terminated, true);
  assert.deepEqual(progress, [{ stage: "loading-model", progress: 35 }]);
  assert.deepEqual(result, {
    strategy: "local-transformers.js",
    segments: [{ index: 3, start: 0, end: 1, text: "Hello" }],
  });
});

test("client translator maps worker progress into bounded translation progress events", async () => {
  const localTranslatorWorker = async (request, onProgress) => {
    onProgress(0.5);
    onProgress({ progress: -10 });
    onProgress({ stage: "loading-model", progress: 30 });
    return { segments: [{ index: 1, text: "Hello" }] };
  };
  const progress = [];
  const translator = createClientTranslator({
    environment: {},
    localTranslatorWorker,
  });

  await translator.translateSegments(
    {
      segments: [{ index: 1, start: 0, end: 1, text: "Bonjour" }],
      sourceLanguage: "fr",
      targetLanguage: "en",
    },
    (event) => progress.push(event),
  );

  assert.deepEqual(progress, [
    { stage: "translating", progress: 50 },
    { stage: "translating", progress: 0 },
    { stage: "loading-model", progress: 30 },
  ]);
});

test("client translator rejects segment batches beyond the configured browser limit", async () => {
  let workerCalled = false;
  const translator = createClientTranslator({
    environment: {},
    localTranslatorWorker: async () => {
      workerCalled = true;
      return { segments: [] };
    },
    maxSegments: 1,
  });

  await assert.rejects(
    () => translator.translateSegments({
      segments: [
        { index: 1, start: 0, end: 1, text: "Bonjour" },
        { index: 2, start: 1, end: 2, text: "le monde" },
      ],
      sourceLanguage: "fr",
      targetLanguage: "en",
    }),
    /Browser translation limit exceeded: 2 segments is greater than the 1 segment limit\./,
  );
  assert.equal(workerCalled, false);
});

test("client translator sends long translation inputs through bounded worker batches", async () => {
  const calls = [];
  const translator = createClientTranslator({
    environment: {},
    maxBatchSize: 2,
    localTranslatorWorker: async (request) => {
      calls.push(request.segments.map((segment) => segment.index));
      return {
        segments: request.segments.map((segment) => ({
          index: segment.index,
          text: `EN:${segment.text}`,
        })),
      };
    },
  });
  const segments = [
    { index: 1, start: 0, end: 1, text: "un" },
    { index: 2, start: 1, end: 2, text: "deux" },
    { index: 3, start: 2, end: 3, text: "trois" },
    { index: 4, start: 3, end: 4, text: "quatre" },
    { index: 5, start: 4, end: 5, text: "cinq" },
  ];

  const result = await translator.translateSegments({
    segments,
    sourceLanguage: "fr",
    targetLanguage: "en",
  });

  assert.deepEqual(calls, [[1, 2], [3, 4], [5]]);
  assert.deepEqual(result, {
    strategy: "local-transformers.js",
    segments: [
      { index: 1, start: 0, end: 1, text: "EN:un" },
      { index: 2, start: 1, end: 2, text: "EN:deux" },
      { index: 3, start: 2, end: 3, text: "EN:trois" },
      { index: 4, start: 3, end: 4, text: "EN:quatre" },
      { index: 5, start: 4, end: 5, text: "EN:cinq" },
    ],
  });
});

test("client translator maps batched worker progress onto the full translation range", async () => {
  const progress = [];
  const translator = createClientTranslator({
    environment: {},
    maxBatchSize: 1,
    localTranslatorWorker: async (request, onProgress) => {
      onProgress({ stage: "translating", progress: 50 });
      onProgress({ stage: "translating", progress: 100 });
      return {
        segments: request.segments.map((segment) => ({ index: segment.index, text: `EN:${segment.text}` })),
      };
    },
  });

  await translator.translateSegments(
    {
      segments: [
        { index: 1, start: 0, end: 1, text: "un" },
        { index: 2, start: 1, end: 2, text: "deux" },
      ],
      sourceLanguage: "fr",
      targetLanguage: "en",
    },
    (event) => progress.push(event),
  );

  assert.deepEqual(progress, [
    { stage: "translating", progress: 25 },
    { stage: "translating", progress: 50 },
    { stage: "translating", progress: 75 },
    { stage: "translating", progress: 100 },
  ]);
});

test("client translator fails explicitly when no local or cloud translation path is configured", async () => {
  const translator = createClientTranslator({ environment: {} });

  await assert.rejects(
    () => translator.translateSegments({
      segments: [{ index: 1, start: 0, end: 1, text: "Bonjour" }],
      sourceLanguage: "fr",
      targetLanguage: "en",
    }),
    /Browser translation requires transformers\.js or a configured cloud translation provider\./,
  );
});
