import test from "node:test";
import assert from "node:assert/strict";

import {
  createAppFfmpegWasmAudioExtractor,
  DEFAULT_FFMPEG_CORE_PATH,
  DEFAULT_FFMPEG_WASM_PATH,
  DEFAULT_FFMPEG_WORKER_PATH,
} from "../frontend/ffmpeg_wasm_runtime.js";

test("app ffmpeg wasm runtime creates an extractor from the browser FFmpeg global", async () => {
  const calls = [];
  const ffmpeg = {
    loaded: true,
    isLoaded() {
      calls.push("isLoaded");
      return this.loaded;
    },
    FS(command, path, data) {
      calls.push(["FS", command, path, data ? [...data] : undefined]);
      if (command === "readFile") return new Uint8Array([82, 73, 70, 70]);
      return undefined;
    },
    async run(...args) {
      calls.push(["run", ...args]);
    },
    terminate() {
      calls.push("terminate");
    },
  };
  const environment = {
    FFmpeg: {
      createFFmpeg(options) {
        calls.push(["createFFmpeg", options]);
        return ffmpeg;
      },
      async fetchFile(file) {
        calls.push(["fetchFile", file.name]);
        return new Uint8Array(await file.arrayBuffer());
      },
    },
    location: { href: "http://localhost:4173/index.html" },
    document: {
      createElement() {
        throw new Error("duration probe should not run when file duration is provided");
      },
    },
  };

  const extractor = createAppFfmpegWasmAudioExtractor({ environment, log: true });
  assert.equal(typeof extractor, "function");

  const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "durationSeconds", { value: 1 });

  const result = await extractor(file);

  assert.equal(result.audioFileName, "clip.wav");
  assert.equal(result.audioSizeBytes, 4);
  assert.deepEqual(calls[0], ["createFFmpeg", {
    corePath: `http://localhost:4173${DEFAULT_FFMPEG_CORE_PATH}`,
    wasmPath: `http://localhost:4173${DEFAULT_FFMPEG_WASM_PATH}`,
    workerPath: `http://localhost:4173${DEFAULT_FFMPEG_WORKER_PATH}`,
    log: true,
  }]);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "run"));
});

test("app ffmpeg wasm runtime stays disabled when the browser FFmpeg global is absent", () => {
  assert.equal(createAppFfmpegWasmAudioExtractor({ environment: {} }), undefined);
});
