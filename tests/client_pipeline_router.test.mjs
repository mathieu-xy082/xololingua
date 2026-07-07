import test from "node:test";
import assert from "node:assert/strict";

import { createHybridPipelineRouter } from "../frontend/client_pipeline_router.js";

test("hybrid pipeline router runs browser audio extraction when the stage is browser-ready", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "ffmpeg.wasm" },
      },
    },
    clientAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["client", file.name]);
        onProgress(100);
        return { audioId: "browser-audio", sampleRate: 16000 };
      },
    },
    serverAdapters: {
      audioExtraction: async () => {
        calls.push(["server"]);
        return { audioId: "server-audio" };
      },
    },
  });
  const progress = [];

  const result = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["client", "clip.mp4"]]);
  assert.deepEqual(progress, [100]);
  assert.deepEqual(result, {
    runtime: "browser",
    strategy: "ffmpeg.wasm",
    payload: { audioId: "browser-audio", sampleRate: 16000 },
  });
});

test("hybrid pipeline router falls back to the Python audio endpoint when browser extraction is unavailable", async () => {
  const calls = [];
  const router = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {
      audioExtraction: async () => {
        calls.push(["client"]);
        return { audioId: "browser-audio" };
      },
    },
    serverAdapters: {
      audioExtraction: async (file, onProgress) => {
        calls.push(["server", file.name]);
        onProgress(35);
        return { audioId: "server-audio", audioFileName: "clip.wav" };
      },
    },
  });
  const progress = [];

  const result = await router.runAudioExtraction({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.deepEqual(calls, [["server", "clip.mp4"]]);
  assert.deepEqual(progress, [35]);
  assert.deepEqual(result, {
    runtime: "server-fallback",
    strategy: "unavailable",
    fallbackEndpoint: "POST /api/extract-audio",
    payload: { audioId: "server-audio", audioFileName: "clip.wav" },
  });
});

test("hybrid pipeline router fails explicitly when the selected audio adapter is missing", async () => {
  const browserRouter = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "browser", strategy: "webcodecs" },
      },
    },
    clientAdapters: {},
    serverAdapters: {},
  });
  const fallbackRouter = createHybridPipelineRouter({
    capabilityReport: {
      stages: {
        audioExtraction: { runtime: "server-fallback", strategy: "unavailable" },
      },
    },
    clientAdapters: {},
    serverAdapters: {},
  });

  await assert.rejects(
    () => browserRouter.runAudioExtraction({ name: "clip.mp4" }),
    /Browser audio extraction adapter is not configured\./,
  );
  await assert.rejects(
    () => fallbackRouter.runAudioExtraction({ name: "clip.mp4" }),
    /Python fallback audio extraction adapter is not configured\./,
  );
});
