import test from "node:test";
import assert from "node:assert/strict";

import { createAppHybridPipelineRouter } from "../frontend/app_hybrid_router_wiring.js";

test("app hybrid router wiring keeps audio extraction and VAD on explicit Python fallback adapters", async () => {
  const calls = [];
  const backendClient = {
    extractAudio: async (file, onProgress) => {
      calls.push(["extractAudio", file.name]);
      onProgress(35);
      return { audioId: "audio-123", audioFileName: "clip.wav", audioSizeBytes: 4096 };
    },
    segmentAudio: async (audioId, onProgress) => {
      calls.push(["segmentAudio", audioId]);
      onProgress(100);
      return [{ index: 1, start: 0, end: 1.5, text: "Speech segment 1" }];
    },
  };
  const router = createAppHybridPipelineRouter({
    backendClient,
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "python-backend" },
        vad: { runtime: "server-fallback", strategy: "python-backend" },
      },
    },
  });
  const progress = [];

  const extraction = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(["audio", value]));
  const segmentation = await router.runVadSegmentation(extraction.payload.audioId, (value) => progress.push(["vad", value]));

  assert.deepEqual(calls, [
    ["extractAudio", "clip.mp4"],
    ["segmentAudio", "audio-123"],
  ]);
  assert.deepEqual(progress, [
    ["audio", 35],
    ["vad", 100],
  ]);
  assert.deepEqual(extraction, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/extract-audio"],
    payload: { audioId: "audio-123", audioFileName: "clip.wav", audioSizeBytes: 4096 },
  });
  assert.deepEqual(segmentation, {
    runtime: "server-fallback",
    strategy: "python-backend",
    fallbackEndpoints: ["POST /api/segment-audio"],
    payload: [{ index: 1, start: 0, end: 1.5, text: "Speech segment 1" }],
  });
});

test("app hybrid router wiring downgrades browser-ready stages to Python fallback until app client adapters are configured", async () => {
  const calls = [];
  const router = createAppHybridPipelineRouter({
    backendClient: {
      extractAudio: async (file) => {
        calls.push(["server-audio", file.name]);
        return { audioId: "server-audio" };
      },
      segmentAudio: async (audioId) => {
        calls.push(["server-vad", audioId]);
        return [];
      },
    },
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
        vad: { runtime: "browser", strategy: "web-audio-vad" },
      },
    },
  });

  const extraction = await router.runAudioExtraction({ name: "clip.mp4" });
  const segmentation = await router.runVadSegmentation(extraction.payload.audioId);

  assert.deepEqual(calls, [
    ["server-audio", "clip.mp4"],
    ["server-vad", "server-audio"],
  ]);
  assert.equal(extraction.runtime, "server-fallback");
  assert.equal(extraction.strategy, "ffmpeg.wasm");
  assert.equal(segmentation.runtime, "server-fallback");
  assert.equal(segmentation.strategy, "web-audio-vad");
});
