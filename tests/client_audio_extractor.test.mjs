import test from "node:test";
import assert from "node:assert/strict";

import {
  createClientAudioExtractor,
  detectClientAudioExtractionCapabilities,
} from "../frontend/client_audio_extractor.js";

test("detectClientAudioExtractionCapabilities reports native WebCodecs readiness", () => {
  const capabilities = detectClientAudioExtractionCapabilities({
    VideoDecoder: function VideoDecoder() {},
    AudioDecoder: function AudioDecoder() {},
    AudioContext: function AudioContext() {},
  });

  assert.deepEqual(capabilities, {
    webCodecs: true,
    ffmpegWasm: false,
    strategy: "webcodecs",
  });
});

test("client audio extractor uses an explicit ffmpeg wasm fallback when WebCodecs is missing", async () => {
  const calls = [];
  const fallbackExtractor = async (file, onProgress) => {
    calls.push(file.name);
    onProgress(100);
    return {
      pcm: new Float32Array([0.25, -0.25]),
      sampleRate: 16000,
      channelCount: 1,
    };
  };
  const progress = [];
  const extractor = createClientAudioExtractor({
    environment: {},
    ffmpegWasmExtractor: fallbackExtractor,
  });

  const result = await extractor.extractAudio({ name: "clip.mp4" }, (value) => progress.push(value));

  assert.equal(result.strategy, "ffmpeg.wasm");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.channelCount, 1);
  assert.deepEqual([...result.pcm], [0.25, -0.25]);
  assert.deepEqual(calls, ["clip.mp4"]);
  assert.deepEqual(progress, [0, 100]);
});

test("client audio extractor fails explicitly when no browser extraction path is available", async () => {
  const extractor = createClientAudioExtractor({ environment: {} });

  await assert.rejects(
    () => extractor.extractAudio({ name: "clip.mp4" }),
    /Browser audio extraction requires WebCodecs or a configured ffmpeg\.wasm fallback\./,
  );
});
