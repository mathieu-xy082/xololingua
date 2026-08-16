import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuntimeMetadata,
  loadPipelineWithDeviceFallback,
  selectBrowserInferenceDevice,
} from "../frontend/browser_inference_device.js";

test("browser inference selects an NVIDIA WebGPU adapter when available", async () => {
  const selection = await selectBrowserInferenceDevice({
    environment: {
      navigator: {
        gpu: {
          requestAdapter: async (options) => {
            assert.deepEqual(options, { powerPreference: "high-performance" });
            return { info: { vendor: "nvidia", architecture: "lovelace" } };
          },
        },
      },
    },
  });

  assert.deepEqual(selection, {
    device: "webgpu",
    deviceLabel: "WebGPU (NVIDIA Lovelace)",
    adapterInfo: { vendor: "nvidia", architecture: "lovelace" },
    fallbackReason: "",
  });
});

test("browser inference selects WASM when Chrome exposes no WebGPU adapter", async () => {
  const selection = await selectBrowserInferenceDevice({
    environment: { navigator: { gpu: { requestAdapter: async () => null } } },
  });

  assert.equal(selection.device, "wasm");
  assert.equal(selection.deviceLabel, "WASM CPU");
  assert.match(selection.fallbackReason, /did not provide a WebGPU adapter/);
});

test("pipeline initialization falls back from WebGPU to WASM and reports the reason", async () => {
  const calls = [];
  const lifecycle = [];
  const cpuPipeline = () => "ok";
  const loaded = await loadPipelineWithDeviceFallback({
    createPipeline: async (task, modelId, options) => {
      calls.push({ task, modelId, options });
      if (options.device === "webgpu") throw new Error("unsupported GPU operator");
      return cpuPipeline;
    },
    task: "automatic-speech-recognition",
    modelId: "Xenova/whisper-base",
    dtype: "q4",
    environment: {
      navigator: {
        gpu: { requestAdapter: async () => ({ info: { vendor: "nvidia" } }) },
      },
    },
    onLifecycle: (event) => lifecycle.push(event),
  });

  assert.deepEqual(calls.map((call) => call.options.device), ["webgpu", "wasm"]);
  assert.equal(loaded.pipeline, cpuPipeline);
  assert.equal(loaded.runtime.device, "wasm");
  assert.match(loaded.runtime.fallbackReason, /unsupported GPU operator/);
  assert.deepEqual(lifecycle.map((event) => event.device), ["webgpu", "wasm"]);
  assert.deepEqual(createRuntimeMetadata(loaded.runtime), {
    executionDevice: "wasm",
    executionDeviceLabel: "WASM CPU",
    deviceFallbackReason: "WebGPU pipeline initialization failed: unsupported GPU operator",
  });
});
