import test from "node:test";
import assert from "node:assert/strict";

import {
  createClientAudioExtractor,
  createFfmpegWasmAudioExtractor,
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

test("ffmpeg wasm audio extractor converts an MP4 file to mono 16 kHz WAV", async () => {
  const operations = [];
  const ffmpeg = {
    loaded: false,
    isLoaded() {
      return this.loaded;
    },
    async load() {
      operations.push(["load"]);
      this.loaded = true;
    },
    FS(command, path, data) {
      operations.push(["FS", command, path, data ? [...data] : undefined]);
      if (command === "readFile") return new Uint8Array([82, 73, 70, 70]);
      return undefined;
    },
    async run(...args) {
      operations.push(["run", ...args]);
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async (file) => new Uint8Array(await file.arrayBuffer()),
  });

  const result = await extractor(new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }));

  assert.deepEqual(operations, [
    ["load"],
    ["FS", "writeFile", "input.mp4", [1, 2, 3]],
    [
      "run",
      "-i",
      "input.mp4",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "output.wav",
    ],
    ["FS", "readFile", "output.wav", undefined],
    ["FS", "unlink", "input.mp4", undefined],
    ["FS", "unlink", "output.wav", undefined],
  ]);
  assert.equal(result.audioFileName, "clip.wav");
  assert.equal(result.audioSizeBytes, 4);
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.channelCount, 1);
  assert.ok(result.audioBlob instanceof Blob);
});

test("ffmpeg wasm audio extractor rejects videos over the browser demo duration limit", async () => {
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg: {},
    fetchFile: async () => new Uint8Array(),
    maxDurationSeconds: 30,
  });

  await assert.rejects(
    () => extractor({ name: "long.mp4", durationSeconds: 31 }),
    /Browser ffmpeg\.wasm extraction is limited to short videos up to 30 seconds\./,
  );
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
