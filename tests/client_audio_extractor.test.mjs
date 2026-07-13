import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrowserVideoDurationProbe,
  createClientAudioExtractor,
  createFfmpegWasmAudioExtractor,
  detectClientAudioExtractionCapabilities,
} from "../frontend/client_audio_extractor.js";

const TestFile = globalThis.File ?? class FilePolyfill extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = String(name);
    this.lastModified = options.lastModified ?? Date.now();
  }
};

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

  const result = await extractor(new TestFile([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }));

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

  await extractor(new TestFile([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }));

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

test("ffmpeg wasm audio extractor rejects fetched bytes over the browser limit before writing wasm FS", async () => {
  const calls = [];
  const ffmpeg = {
    isLoaded() {
      calls.push("isLoaded");
      return true;
    },
    FS(command, path) {
      calls.push(["FS", command, path]);
    },
    async run(...args) {
      calls.push(["run", ...args]);
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async () => {
      calls.push("fetchFile");
      return new Uint8Array(1025);
    },
    maxInputBytes: 1024,
    releaseAfterRun: true,
  });

  await assert.rejects(
    () => extractor({ name: "streamed.mp4" }),
    /Browser ffmpeg\.wasm extraction received 1 KiB after loading the input\./,
  );
  assert.deepEqual(calls, ["isLoaded", "fetchFile", "terminate"]);
});

test("ffmpeg wasm audio extractor releases the wasm runtime when wasm loading fails", async () => {
  const calls = [];
  const ffmpeg = {
    isLoaded() {
      calls.push("isLoaded");
      return false;
    },
    async load() {
      calls.push("load");
      throw new Error("wasm heap unavailable");
    },
    FS(command, path) {
      calls.push(["FS", command, path]);
    },
    async run(...args) {
      calls.push(["run", ...args]);
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async () => {
      calls.push("fetchFile");
      return new Uint8Array();
    },
    releaseAfterRun: true,
  });

  await assert.rejects(
    () => extractor({ name: "heap-pressure.mp4" }),
    (error) => {
      assert.match(error.message, /Browser ffmpeg\.wasm audio extraction could not load the wasm runtime for heap-pressure\.mp4\./);
      assert.match(error.message, /Use the Python fallback for this video\./);
      assert.equal(error.cause?.message, "wasm heap unavailable");
      return true;
    },
  );
  assert.deepEqual(calls, ["isLoaded", "load", "terminate"]);
});

test("ffmpeg wasm audio extractor releases the wasm runtime when browser input loading fails", async () => {
  const calls = [];
  const ffmpeg = {
    isLoaded() {
      calls.push("isLoaded");
      return true;
    },
    FS(command, path) {
      calls.push(["FS", command, path]);
    },
    async run(...args) {
      calls.push(["run", ...args]);
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async () => {
      calls.push("fetchFile");
      throw new Error("array buffer exhausted");
    },
    releaseAfterRun: true,
  });

  await assert.rejects(
    () => extractor({ name: "memory-hungry.mp4" }),
    (error) => {
      assert.match(error.message, /Browser ffmpeg\.wasm audio extraction could not load memory-hungry\.mp4 into browser memory\./);
      assert.match(error.message, /Use the Python fallback for this video\./);
      assert.equal(error.cause?.message, "array buffer exhausted");
      return true;
    },
  );
  assert.deepEqual(calls, ["isLoaded", "fetchFile", "terminate"]);
});

test("ffmpeg wasm audio extractor rejects empty wasm output with explicit fallback guidance", async () => {
  const calls = [];
  const ffmpeg = {
    isLoaded() {
      calls.push("isLoaded");
      return true;
    },
    FS(command, path, data) {
      calls.push(["FS", command, path, data ? [...data] : undefined]);
      if (command === "readFile") return new Uint8Array();
      return undefined;
    },
    async run(...args) {
      calls.push(["run", ...args]);
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async (file) => new Uint8Array(await file.arrayBuffer()),
    releaseAfterRun: true,
  });

  await assert.rejects(
    () => extractor(new TestFile([new Uint8Array([1, 2, 3])], "silent.mp4", { type: "video/mp4" })),
    (error) => {
      assert.match(error.message, /Browser ffmpeg\.wasm audio extraction produced no audio bytes for silent\.mp4\./);
      assert.match(error.message, /Use the Python fallback for this video\./);
      return true;
    },
  );
  assert.deepEqual(calls.slice(-3), [
    ["FS", "unlink", "input.mp4", undefined],
    ["FS", "unlink", "output.wav", undefined],
    "terminate",
  ]);
});

test("ffmpeg wasm audio extractor reports transcoding failures with explicit fallback guidance", async () => {
  const calls = [];
  const ffmpeg = {
    isLoaded() {
      calls.push("isLoaded");
      return true;
    },
    FS(command, path, data) {
      calls.push(["FS", command, path, data ? [...data] : undefined]);
    },
    async run(...args) {
      calls.push(["run", ...args]);
      throw new Error("demux failed");
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const extractor = createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile: async (file) => new Uint8Array(await file.arrayBuffer()),
    releaseAfterRun: true,
  });

  await assert.rejects(
    () => extractor(new TestFile([new Uint8Array([1, 2, 3])], "broken.mp4", { type: "video/mp4" })),
    (error) => {
      assert.match(error.message, /Browser ffmpeg\.wasm audio extraction failed for broken\.mp4\./);
      assert.match(error.message, /Use the Python fallback for this video\./);
      assert.equal(error.cause?.message, "demux failed");
      return true;
    },
  );
  assert.deepEqual(calls.slice(-3), [
    ["FS", "unlink", "input.mp4", undefined],
    ["FS", "unlink", "output.wav", undefined],
    "terminate",
  ]);
  assert.deepEqual(calls[2], [
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
  ]);
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

test("ffmpeg wasm audio extractor reports duration probe failures with fallback guidance before loading wasm", async () => {
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
      throw new Error("metadata unavailable");
    },
  });

  await assert.rejects(
    () => extractor({ name: "unreadable.mp4" }),
    (error) => {
      assert.match(error.message, /Browser ffmpeg\.wasm audio extraction could not read video duration for unreadable\.mp4\./);
      assert.match(error.message, /Use the Python fallback for this video\./);
      assert.equal(error.cause?.message, "metadata unavailable");
      return true;
    },
  );
  assert.deepEqual(calls, [["durationProbe", "unreadable.mp4"]]);
});

test("ffmpeg wasm audio extractor rejects non-finite duration metadata before loading wasm", async () => {
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
      return Number.NaN;
    },
  });

  await assert.rejects(
    () => extractor({ name: "live-stream.mp4" }),
    /Browser ffmpeg\.wasm audio extraction requires finite video duration metadata for live-stream\.mp4\. Use the Python fallback for this video\./,
  );
  assert.deepEqual(calls, [["durationProbe", "live-stream.mp4"]]);
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

test("browser video duration probe times out and releases object URLs when metadata stalls", async () => {
  const calls = [];
  const timers = [];
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
        return "blob:stalled";
      },
      revokeObjectURL(url) {
        calls.push(["revokeObjectURL", url]);
      },
    },
    setTimeout(callback, timeoutMs) {
      timers.push([callback, timeoutMs]);
      return "metadata-timeout";
    },
    clearTimeout(timerId) {
      calls.push(["clearTimeout", timerId]);
    },
  }, { metadataTimeoutMs: 123 });

  const promise = probe({ name: "stalled.mp4" });
  assert.equal(video.preload, "metadata");
  assert.equal(video.src, "blob:stalled");
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 123);

  timers[0][0]();

  await assert.rejects(
    promise,
    /Timed out after 123 ms while reading browser video metadata for audio extraction\./,
  );
  assert.equal(video.src, "");
  assert.deepEqual(calls, [
    ["createElement", "video"],
    ["createObjectURL", "stalled.mp4"],
    ["revokeObjectURL", "blob:stalled"],
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
