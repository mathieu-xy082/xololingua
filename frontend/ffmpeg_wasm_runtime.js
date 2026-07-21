import {
  createBrowserVideoDurationProbe,
  createFfmpegWasmAudioExtractor,
} from "./client_audio_extractor.js";

const DEFAULT_FFMPEG_CORE_PATH = "/node_modules/@ffmpeg/core/dist/ffmpeg-core.js";
const DEFAULT_FFMPEG_WASM_PATH = "/node_modules/@ffmpeg/core/dist/ffmpeg-core.wasm";
const DEFAULT_FFMPEG_WORKER_PATH = "/node_modules/@ffmpeg/core/dist/ffmpeg-core.worker.js";

export function createAppFfmpegWasmAudioExtractor({
  environment = globalThis,
  corePath = DEFAULT_FFMPEG_CORE_PATH,
  wasmPath = DEFAULT_FFMPEG_WASM_PATH,
  workerPath = DEFAULT_FFMPEG_WORKER_PATH,
  log = false,
} = {}) {
  const ffmpegGlobal = environment.FFmpeg || environment.ffmpegWasm;
  const createFFmpeg = environment.createFFmpeg || ffmpegGlobal?.createFFmpeg;
  const fetchFile = ffmpegGlobal?.fetchFile || environment.fetchFile;

  if (typeof createFFmpeg !== "function" || typeof fetchFile !== "function") {
    return undefined;
  }

  const ffmpeg = createFFmpeg({
    corePath: resolveAssetUrl(corePath, environment),
    wasmPath: resolveAssetUrl(wasmPath, environment),
    workerPath: resolveAssetUrl(workerPath, environment),
    log,
  });

  return createFfmpegWasmAudioExtractor({
    ffmpeg,
    fetchFile,
    durationProbe: createBrowserVideoDurationProbe(environment),
    releaseAfterRun: true,
  });
}

function resolveAssetUrl(path, environment) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  const baseUrl = environment.location?.href || globalThis.location?.href || "http://127.0.0.1:4173/";
  return new URL(path, baseUrl).href;
}

export { DEFAULT_FFMPEG_CORE_PATH, DEFAULT_FFMPEG_WASM_PATH, DEFAULT_FFMPEG_WORKER_PATH };
