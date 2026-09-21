import test from "node:test";
import assert from "node:assert/strict";

import { createClientLanguageDetector } from "../frontend/client_language_detector.js";
import { resolveTranscriptionModel } from "../frontend/dynamic_model_resolver.js";

test("client language detector samples PCM and reports a browser result", async () => {
  const requests = [];
  const progress = [];
  const detector = createClientLanguageDetector({
    environment: {},
    sampleCount: 2,
    sampleSeconds: 1,
    modelResolver: resolveTranscriptionModel,
    detectorWorker: async (request, onProgress) => {
      requests.push(request);
      onProgress({ stage: "detecting-language", progress: 50 });
      return {
        languageCode: "ru",
        confidence: 0.92,
        votes: { ru: 2 },
        sampleCount: 2,
        executionDevice: "webgpu",
        executionDeviceLabel: "WebGPU (NVIDIA)",
      };
    },
  });
  const result = await detector.detectLanguage({
    audio: { pcm: new Float32Array(40), sampleRate: 10 },
  }, (event) => progress.push(event));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].samples.length, 2);
  assert.equal(requests[0].modelId, "Xenova/whisper-base");
  assert.equal(requests[0].remoteModels, true);
  assert.deepEqual(requests[0].samples.map((sample) => sample.pcm.length), [10, 10]);
  assert.equal(result.languageCode, "ru");
  assert.equal(result.lowConfidence, false);
  assert.equal(result.executionDevice, "webgpu");
  assert.ok(progress.some((event) => event.stage === "preparing-language-samples"));
});

test("client language detector restarts in a fresh WASM worker after a browser inference failure", async () => {
  const workerInstances = [];
  class Worker {
    constructor() {
      this.id = workerInstances.length + 1;
      workerInstances.push(this);
    }
    postMessage(message) {
      this.message = message;
      queueMicrotask(() => {
        if (this.id === 1) {
          this.onmessage({ data: { type: "progress", event: {
            stage: "inference-runtime",
            progress: 1,
            device: "webgpu",
            deviceLabel: "WebGPU",
          } } });
          this.onmessage({ data: { type: "error", error: "WebGPU device lost" } });
        } else {
          this.onmessage({ data: { type: "language-result", result: {
            languageCode: "fr",
            confidence: 0.8,
            votes: { fr: 1 },
            sampleCount: 1,
            executionDevice: "wasm",
            executionDeviceLabel: "WASM CPU",
          } } });
        }
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  const progress = [];
  const detector = createClientLanguageDetector({
    environment: { Worker },
    workerUrl: "/frontend/transcription_worker.js",
    sampleCount: 1,
    sampleSeconds: 1,
  });

  const result = await detector.detectLanguage({
    audio: { pcm: new Float32Array(10), sampleRate: 10 },
  }, (event) => progress.push(event));

  assert.equal(workerInstances.length, 2);
  assert.equal(workerInstances[0].terminated, true);
  assert.equal(workerInstances[1].message.request.device, "wasm");
  assert.equal(result.executionDevice, "wasm");
  assert.ok(progress.some((event) => event.fallbackReason === "WebGPU device lost"));
});

test("client language detector can purge retained Whisper files when a video is abandoned", async () => {
  const messages = [];
  class Worker {
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.onmessage({ data: {
        type: "dispose-complete",
        metadata: { cachePurged: true, filesDeleted: 4 },
      } }));
    }
    terminate() {}
  }
  const detector = createClientLanguageDetector({
    environment: { Worker },
    workerUrl: "/frontend/transcription_worker.js",
    modelId: "Xenova/whisper-base",
  });

  const result = await detector.purgeCache();

  assert.deepEqual(messages, [{
    type: "dispose",
    request: { modelId: "Xenova/whisper-base", dtype: "q4", purgeCache: true },
  }]);
  assert.deepEqual(result, { cachePurged: true, filesDeleted: 4 });
});
