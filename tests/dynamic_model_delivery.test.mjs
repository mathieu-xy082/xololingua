import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClientTranscriber, detectClientTranscriptionCapabilities } from "../frontend/client_transcriber.js";
import { createClientTranslator, detectClientTranslationCapabilities } from "../frontend/client_translator.js";
import { resolveTranscriptionModel, resolveTranslationModel } from "../frontend/dynamic_model_resolver.js";

test("dynamic model resolver selects Whisper and an OPUS model from the requested language pair", () => {
  assert.equal(resolveTranscriptionModel({ sourceLanguage: { code: "fr" } }).modelId, "Xenova/whisper-base");
  assert.deepEqual(resolveTranslationModel({ sourceLanguage: { code: "fr" }, targetLanguage: "ru" }), {
    stage: "translation",
    sourceLanguage: "fr",
    targetLanguage: "ru",
    modelId: "Xenova/opus-mt-fr-ru",
    task: "translation",
    remote: true,
    purgeAfterUse: true,
    dtype: "q4",
  });
});

test("dynamic model resolver rejects unsafe or identical language pairs", () => {
  assert.throws(() => resolveTranslationModel({ sourceLanguage: "fr", targetLanguage: "fr" }), /different source and target/);
  assert.throws(() => resolveTranslationModel({ sourceLanguage: "fr/../../", targetLanguage: "ru" }), /Unsupported language code/);
});

test("dynamic model resolver selects a bounded English pivot when no direct pair is registered", () => {
  const result = resolveTranslationModel({ sourceLanguage: "fr", targetLanguage: "zh" });

  assert.equal(result.pivotLanguage, "en");
  assert.deepEqual(result.route.map((step) => step.modelId), [
    "Xenova/opus-mt-fr-en",
    "Xenova/opus-mt-en-zh",
  ]);
});

test("dynamic ML capabilities are explicit and keep legacy local detection unchanged", () => {
  const dynamicEnvironment = { Worker() {}, __xololinguaDynamicModels: true };
  assert.equal(detectClientTranscriptionCapabilities(dynamicEnvironment).strategy, "remote-transformers.js");
  assert.equal(detectClientTranslationCapabilities(dynamicEnvironment).strategy, "remote-transformers.js");
  assert.equal(detectClientTranslationCapabilities({ Worker() {} }).strategy, "local-transformers.js");
});

test("dynamic translation sends one transient pair-specific worker request", async () => {
  const messages = [];
  class Worker {
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.onmessage({ data: {
        type: "result",
        result: {
          segments: message.request.segments.map((segment) => ({ index: segment.index, text: `RU:${segment.text}` })),
          metadata: { cachePurged: true, filesDeleted: 7 },
        },
      } }));
    }
    terminate() {}
  }
  const segments = [
    { index: 1, start: 0, end: 1, text: "Bonjour" },
    { index: 2, start: 1, end: 2, text: "monde" },
  ];
  const translator = createClientTranslator({
    environment: { Worker },
    workerUrl: "/frontend/translation_worker.js",
    modelResolver: resolveTranslationModel,
    devicePreference: "auto",
    maxBatchSize: 1,
  });

  const result = await translator.translateSegments({ segments, sourceLanguage: { code: "fr" }, targetLanguage: "ru" });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].request, {
    modelId: "Xenova/opus-mt-fr-ru",
    segments,
    sourceLanguage: { code: "fr" },
    targetLanguage: "ru",
    remoteModels: true,
    purgeAfterUse: true,
    device: "auto",
  });
  assert.equal(result.metadata.modelId, "Xenova/opus-mt-fr-ru");
  assert.equal(result.metadata.purgeAfterUse, true);
  assert.equal(result.metadata.cachePurged, true);
  assert.equal(result.metadata.filesDeleted, 7);
});

test("dynamic transcription requests a remote transient Whisper model", async () => {
  const calls = [];
  const transcriber = createClientTranscriber({
    environment: {},
    transformerWorker: async (request) => {
      calls.push(request);
      return { language: "fr", segments: [{ index: 1, start: 0, end: 1, text: "Bonjour" }] };
    },
    modelResolver: resolveTranscriptionModel,
    devicePreference: "auto",
  });

  await transcriber.transcribeAudio({ audio: { pcm: new Float32Array([0]) }, segments: [], sourceLanguage: "fr" });

  assert.equal(calls[0].modelId, "Xenova/whisper-base");
  assert.equal(calls[0].remoteModels, true);
  assert.equal(calls[0].purgeAfterUse, true);
  assert.equal(calls[0].device, "auto");
});

test("workers release runtime memory and clear their targeted Transformers.js caches", () => {
  for (const worker of ["transcription_worker.js", "translation_worker.js"]) {
    const source = readFileSync(new URL(`../frontend/${worker}`, import.meta.url), "utf8");
    assert.match(source, /\.dispose\(\)/);
    assert.match(source, /ModelRegistry\.clear_pipeline_cache/);
    assert.match(source, /purgeAfterUse/);
    assert.match(source, /cache:\s*"no-store"/);
    assert.match(source, /loadPipelineWithDeviceFallback/);
  }
});

test("dynamic model workers are syntactically valid JavaScript", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const worker of ["transcription_worker.js", "translation_worker.js"]) {
    const checked = spawnSync(process.execPath, ["--check", `frontend/${worker}`], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }
});
