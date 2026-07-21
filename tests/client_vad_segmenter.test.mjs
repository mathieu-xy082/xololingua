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

  const result = await segmenter.segmentAudio(audio, (value) => progress.push(value));

  assert.deepEqual(calls, [audio]);
  assert.deepEqual(progress, [0, 100]);
  assert.deepEqual(result.payload.segments, [
    { start: 0.12, end: 1.34 },
    { start: 2.5, end: 3.75 },
  ]);
});

test("client VAD segmenter returns canonical browser VAD stage envelopes", async () => {
  const segmenter = createClientVadSegmenter({
    environment: {},
    vadWebSegmenter: async () => ({
      segments: [
        { start: 0.12, end: 1.34, confidence: 0.98, speechProbability: 0.87 },
      ],
      diagnostics: {
        speechFrameCount: 42,
      },
    }),
  });

  const result = await segmenter.segmentAudio({ pcm: new Float32Array([0.1]), sampleRate: 16000 });

  assert.deepEqual(result, {
    stage: "vad",
    runtime: "browser",
    strategy: "vad-web",
    payload: {
      segments: [
        { start: 0.12, end: 1.34 },
      ],
    },
    metadata: {
      diagnostics: {
        speechFrameCount: 42,
      },
      segmentDiagnostics: [
        { index: 0, confidence: 0.98, speechProbability: 0.87 },
      ],
    },
  });
});

test("client VAD segmenter preserves segmenter diagnostics in metadata", async () => {
  const segmenter = createClientVadSegmenter({
    environment: {},
    vadWebSegmenter: async () => ({
      segments: [{ start: 0.12, end: 1.34 }],
      diagnostics: { speechFrameCount: 42 },
      model: "silero-v5",
      frameDurationMs: 32,
    }),
  });

  const result = await segmenter.segmentAudio({ pcm: new Float32Array([0.1]), sampleRate: 16000 });

  assert.deepEqual(result.metadata, {
    diagnostics: { speechFrameCount: 42 },
    model: "silero-v5",
    frameDurationMs: 32,
  });
});

test("client VAD segmenter uses the environment segmenter when no explicit injection is provided", async () => {
  const calls = [];
  const environment = {
    createVadSegmenter: async (audio, onProgress) => {
      calls.push(audio.sampleRate);
      onProgress(80);
      return {
        segments: [{ start: 0.25, end: 0.75 }],
        diagnostics: { source: "environment" },
      };
    },
  };
  const progress = [];
  const segmenter = createClientVadSegmenter({ environment });

  const result = await segmenter.segmentAudio(
    { pcm: new Float32Array([0.1, 0.2]), sampleRate: 16000 },
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [16000]);
  assert.deepEqual(progress, [0, 80]);
  assert.deepEqual(result, {
    stage: "vad",
    runtime: "browser",
    strategy: "vad-web",
    payload: {
      segments: [{ start: 0.25, end: 0.75 }],
    },
    metadata: {
      diagnostics: { source: "environment" },
    },
  });
});

test("client VAD segmenter adapts vad-web non-real-time segments into canonical VAD envelopes", async () => {
  const runCalls = [];
  const environment = {
    vad: {
      NonRealTimeVAD: {
        new: async () => ({
          async *run(pcm, sampleRate) {
            runCalls.push({ pcm, sampleRate });
            yield { start: 1600, end: 3200, confidence: 0.92 };
            yield { start: 0.5, end: 0.75, probability: 0.81 };
          },
        }),
      },
    },
  };
  const audio = { pcm: new Float32Array([0.1, -0.1]), sampleRate: 16000 };
  const progress = [];
  const segmenter = createClientVadSegmenter({ environment });

  const result = await segmenter.segmentAudio(audio, (value) => progress.push(value));

  assert.deepEqual(runCalls, [{ pcm: audio.pcm, sampleRate: 16000 }]);
  assert.deepEqual(progress, [0, 100]);
  assert.deepEqual(result, {
    stage: "vad",
    runtime: "browser",
    strategy: "vad-web",
    payload: {
      segments: [
        { start: 0.1, end: 0.2 },
        { start: 0.5, end: 0.75 },
      ],
    },
    metadata: {
      segmentDiagnostics: [
        { index: 0, confidence: 0.92 },
        { index: 1, probability: 0.81 },
      ],
    },
  });
});

test("client VAD segmenter fails explicitly when no browser VAD path is available", async () => {
  const segmenter = createClientVadSegmenter({ environment: {} });

  await assert.rejects(
    () => segmenter.segmentAudio({ pcm: new Float32Array(), sampleRate: 16000, channelCount: 1 }),
    /Browser voice activity detection requires @ricky0123\/vad-web or a configured fallback\./,
  );
});
