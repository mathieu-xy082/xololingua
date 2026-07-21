import test from "node:test";
import assert from "node:assert/strict";

import {
  configureOrtWasmPaths,
  createVadWebRuntimeSegmenter,
  detectVadWebRuntimeCapabilities,
} from "../frontend/vad_web_runtime.js";

test("detectVadWebRuntimeCapabilities requires vad-web NonRealTimeVAD, audio decoding utils, and ORT wasm env", () => {
  assert.deepEqual(detectVadWebRuntimeCapabilities({}), {
    vadWeb: false,
    strategy: "unavailable",
    missing: ["vad.NonRealTimeVAD", "vad.utils.audioFileToArray", "ort.env.wasm"],
  });

  assert.deepEqual(detectVadWebRuntimeCapabilities({
    vad: {
      NonRealTimeVAD: { new: async () => ({}) },
      utils: { audioFileToArray: async () => ({ audio: new Float32Array(), sampleRate: 16000 }) },
    },
    ort: { env: { wasm: {} } },
  }), {
    vadWeb: true,
    strategy: "vad-web",
    missing: [],
  });
});

test("configureOrtWasmPaths pins ORT wasm assets to local node_modules paths", () => {
  const environment = { ort: { env: { wasm: {} } } };

  const configured = configureOrtWasmPaths(environment, "/node_modules/onnxruntime-web/dist/");

  assert.equal(configured, "/node_modules/onnxruntime-web/dist/");
  assert.equal(environment.ort.env.wasm.wasmPaths, "/node_modules/onnxruntime-web/dist/");
  assert.equal(environment.ort.env.wasm.numThreads, 1);
});

test("createVadWebRuntimeSegmenter decodes browser WAV blobs and runs NonRealTimeVAD with explicit local assets", async () => {
  const calls = [];
  const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
  const pcm = new Float32Array([0, 0.2, 0.1, -0.1]);
  const environment = {
    vad: {
      utils: {
        audioFileToArray: async (blob) => {
          calls.push(["audioFileToArray", blob.type]);
          return { audio: pcm, sampleRate: 16000 };
        },
      },
      NonRealTimeVAD: {
        new: async (options) => {
          calls.push([
            "NonRealTimeVAD.new",
            options.modelURL,
            typeof options.ortConfig,
          ]);
          options.ortConfig(environment.ort);
          return {
            async *run(receivedPcm, receivedSampleRate) {
              calls.push(["run", receivedPcm, receivedSampleRate]);
              yield { start: 0, end: 0.25, audio: receivedPcm };
              yield { start: 0.5, end: 0.75, audio: receivedPcm };
            },
          };
        },
      },
    },
    ort: { env: { wasm: {} } },
  };
  const progress = [];

  const segmenter = createVadWebRuntimeSegmenter({ environment });
  const result = await segmenter({ audioBlob, audioFileName: "browser.wav" }, (value) => progress.push(value));

  assert.equal(environment.ort.env.wasm.wasmPaths, "/node_modules/onnxruntime-web/dist/");
  assert.equal(environment.ort.env.wasm.numThreads, 1);
  assert.deepEqual(progress, [0, 15, 35, 100]);
  assert.deepEqual(calls, [
    ["audioFileToArray", "audio/wav"],
    [
      "NonRealTimeVAD.new",
      "/node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
      "function",
    ],
    ["run", pcm, 16000],
  ]);
  assert.deepEqual(result, {
    segments: [
      { start: 0, end: 0.25 },
      { start: 0.5, end: 0.75 },
    ],
    diagnostics: {
      audioFileName: "browser.wav",
      model: "silero-vad-legacy",
      pcmSampleCount: 4,
      rawSegmentCount: 2,
      sourceSampleRate: 16000,
      strategy: "vad-web",
    },
    model: "silero-vad-legacy",
    frameDurationMs: 96,
  });
});

test("createVadWebRuntimeSegmenter defensively converts sample-index VAD timings to seconds", async () => {
  const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
  const pcm = new Float32Array(48000);
  const environment = {
    vad: {
      utils: {
        audioFileToArray: async () => ({ audio: pcm, sampleRate: 16000 }),
      },
      NonRealTimeVAD: {
        new: async (options) => {
          options.ortConfig(environment.ort);
          return {
            async *run() {
              yield { start: 16000, end: 32000 };
              yield { start: 40000, end: 48000 };
            },
          };
        },
      },
    },
    ort: { env: { wasm: {} } },
  };

  const segmenter = createVadWebRuntimeSegmenter({ environment });
  const result = await segmenter({ audioBlob, audioFileName: "browser.wav" });

  assert.deepEqual(result.segments, [
    { start: 1, end: 2 },
    { start: 2.5, end: 3 },
  ]);
});

test("createVadWebRuntimeSegmenter fails explicitly when browser VAD assets are not loaded", async () => {
  const segmenter = createVadWebRuntimeSegmenter({ environment: {} });

  await assert.rejects(
    () => segmenter({ audioBlob: new Blob([new Uint8Array([1])], { type: "audio/wav" }) }),
    /Browser VAD runtime requires vad\.NonRealTimeVAD, vad\.utils\.audioFileToArray, and ort\.env\.wasm/,
  );
});
