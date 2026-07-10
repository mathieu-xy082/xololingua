import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrowserVideoDurationProbe,
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

test("ffmpeg wasm audio extractor releases the wasm runtime after cleanup when requested", async () => {
  const operations = [];
  const ffmpeg = {
    isLoaded() {
      return true;
    },
    FS(command, path, data) {
      operations.push(["FS", command, path, data ? [...data] : undefined]);
      if (command === "readFile") return new Uint8Array([82, 73, 70, 70]);
      return undefined;
    },
    async run(...args) {
      operations.push(["run", ...args]);
    },
    terminate() {
      operations.push(["terminate"]);
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async (file) => new Uint8Array(await file.arrayBuffer()),
    releaseAfterRun: true,
  });

  await extractor(new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }));

  assert.deepEqual(operations.slice(-3), [
    ["FS", "unlink", "input.mp4", undefined],
    ["FS", "unlink", "output.wav", undefined],
    ["terminate"],
  ]);
});

test("ffmpeg wasm audio extractor rejects oversized browser inputs before loading wasm", async () => {
  const calls = [];
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg: {
      isLoaded() {
        calls.push("isLoaded");
        return false;
      },
      async load() {
        calls.push("load");
      },
      FS() {},
      async run() {},
    },
    fetchFile: async () => {
      calls.push("fetchFile");
      return new Uint8Array();
    },
    maxInputBytes: 1024,
  });

  await assert.rejects(
    () => extractor({ name: "large.mp4", size: 1025 }),
    /Browser ffmpeg\.wasm extraction is limited to input files up to 1 KiB\./,
  );
  assert.deepEqual(calls, []);
});

test("ffmpeg wasm audio extractor rejects long real files using a duration probe before loading wasm", async () => {
  const calls = [];
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg: {
      isLoaded() {
        calls.push("isLoaded");
        return false;
      },
      async load() {
        calls.push("load");
      },
      FS() {},
      async run() {},
    },
    fetchFile: async () => {
      calls.push("fetchFile");
      return new Uint8Array();
    },
    durationProbe: async (file) => {
      calls.push(["durationProbe", file.name]);
      return 31;
    },
    maxDurationSeconds: 30,
  });

  await assert.rejects(
    () => extractor({ name: "long.mp4" }),
    /Browser ffmpeg\.wasm extraction is limited to short videos up to 30 seconds\./,
  );
  assert.deepEqual(calls, [["durationProbe", "long.mp4"]]);
});

test("browser video duration probe reads metadata and revokes its object URL", async () => {
  const calls = [];
  const video = {};
  const probe = createBrowserVideoDurationProbe({
    document: {
      createElement(tagName) {
        calls.push(["createElement", tagName]);
        return video;
      },
    },
    URL: {
      createObjectURL(file) {
        calls.push(["createObjectURL", file.name]);
        return "blob:clip";
      },
      revokeObjectURL(url) {
        calls.push(["revokeObjectURL", url]);
      },
    },
  });

  const promise = probe({ name: "clip.mp4" });
  assert.equal(video.preload, "metadata");
  assert.equal(video.src, "blob:clip");
  video.duration = 42.5;
  video.onloadedmetadata();

  assert.equal(await promise, 42.5);
  assert.equal(video.src, "");
  assert.deepEqual(calls, [
    ["createElement", "video"],
    ["createObjectURL", "clip.mp4"],
    ["revokeObjectURL", "blob:clip"],
  ]);
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

test("client audio extractor still uses configured ffmpeg wasm while WebCodecs extraction is not implemented", async () => {
  const calls = [];
  const fallbackExtractor = async (file, onProgress) => {
    calls.push(file.name);
    onProgress(100);
    return {
      audioFileName: "clip.wav",
      sampleRate: 16000,
      channelCount: 1,
    };
  };
  const extractor = createClientAudioExtractor({
    environment: {
      VideoDecoder: function VideoDecoder() {},
      AudioDecoder: function AudioDecoder() {},
      AudioContext: function AudioContext() {},
    },
    ffmpegWasmExtractor: fallbackExtractor,
  });

  const result = await extractor.extractAudio({ name: "clip.mp4" });

  assert.equal(result.strategy, "ffmpeg.wasm");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.audioFileName, "clip.wav");
  assert.deepEqual(calls, ["clip.mp4"]);
});

test("client audio extractor fails explicitly when no browser extraction path is available", async () => {
  const extractor = createClientAudioExtractor({ environment: {} });

  await assert.rejects(
    () => extractor.extractAudio({ name: "clip.mp4" }),
    /Browser audio extraction requires WebCodecs or a configured ffmpeg\.wasm fallback\./,
  );
});
