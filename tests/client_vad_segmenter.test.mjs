import test from "node:test";
import assert from "node:assert/strict";

import {
  createClientVadSegmenter,
  detectClientVadCapabilities,
} from "../frontend/client_vad_segmenter.js";

test("detectClientVadCapabilities reports vad-web readiness", () => {
  const capabilities = detectClientVadCapabilities({
    vad: {
      MicVAD: function MicVAD() {},
    },
  });

  assert.deepEqual(capabilities, {
    vadWeb: true,
    strategy: "vad-web",
  });
});

test("client VAD segmenter delegates PCM audio to an injected vad-web segmenter", async () => {
  const calls = [];
  const vadWebSegmenter = async (audio, onProgress) => {
    calls.push(audio);
    onProgress(100);
    return [
      { start: 0.12, end: 1.34 },
      { start: 2.5, end: 3.75 },
    ];
  };
  const progress = [];
  const audio = {
    pcm: new Float32Array([0.1, -0.1]),
    sampleRate: 16000,
    channelCount: 1,
  };
  const segmenter = createClientVadSegmenter({
    environment: {},
    vadWebSegmenter,
  });

  const segments = await segmenter.segmentAudio(audio, (value) => progress.push(value));

  assert.deepEqual(calls, [audio]);
  assert.deepEqual(progress, [0, 100]);
  assert.deepEqual(segments, [
    { start: 0.12, end: 1.34 },
    { start: 2.5, end: 3.75 },
  ]);
});

test("client VAD segmenter fails explicitly when no browser VAD path is available", async () => {
  const segmenter = createClientVadSegmenter({ environment: {} });

  await assert.rejects(
    () => segmenter.segmentAudio({ pcm: new Float32Array(), sampleRate: 16000, channelCount: 1 }),
    /Browser voice activity detection requires @ricky0123\/vad-web or a configured fallback\./,
  );
});
