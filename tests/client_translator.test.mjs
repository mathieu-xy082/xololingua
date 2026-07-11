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
