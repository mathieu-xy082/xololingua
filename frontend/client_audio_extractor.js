export function detectClientAudioExtractionCapabilities(environment = globalThis) {
  const webCodecs = typeof environment.VideoDecoder === "function"
    && typeof environment.AudioDecoder === "function"
    && typeof environment.AudioContext === "function";
  const ffmpegWasm = typeof environment.createFFmpeg === "function"
    || Boolean(environment.ffmpegWasm);

  return {
    webCodecs,
    ffmpegWasm,
    strategy: webCodecs ? "webcodecs" : ffmpegWasm ? "ffmpeg.wasm" : "unavailable",
  };
}

const DEFAULT_BROWSER_EXTRACTION_MAX_DURATION_SECONDS = 60;
const DEFAULT_BROWSER_EXTRACTION_MAX_INPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_BROWSER_METADATA_TIMEOUT_MS = 10_000;
const FFMPEG_INPUT_NAME = "input.mp4";
const FFMPEG_OUTPUT_NAME = "output.wav";

export function createBrowserVideoDurationProbe(
  environment = globalThis,
  { metadataTimeoutMs = DEFAULT_BROWSER_METADATA_TIMEOUT_MS } = {},
) {
  return function probeBrowserVideoDuration(file) {
    if (typeof environment.document?.createElement !== "function" ||
        typeof environment.URL?.createObjectURL !== "function" ||
        typeof environment.URL?.revokeObjectURL !== "function") {
      throw new Error("Browser video duration probing requires document and URL object URL APIs.");
    }

    const video = environment.document.createElement("video");
    const objectUrl = environment.URL.createObjectURL(file);
    const setTimeoutFn = environment.setTimeout ?? globalThis.setTimeout;
    const clearTimeoutFn = environment.clearTimeout ?? globalThis.clearTimeout;
    video.preload = "metadata";

    return new Promise((resolve, reject) => {
      let timeoutId;
      let didTimeout = false;
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.src = "";
        environment.URL.revokeObjectURL(objectUrl);
        if (!didTimeout && timeoutId !== undefined && typeof clearTimeoutFn === "function") {
          clearTimeoutFn(timeoutId);
        }
      };

      video.onloadedmetadata = () => {
        const durationSeconds = video.duration;
        cleanup();
        resolve(durationSeconds);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("Browser could not read video metadata for audio extraction."));
      };
      if (Number.isFinite(metadataTimeoutMs) && metadataTimeoutMs > 0 && typeof setTimeoutFn === "function") {
        timeoutId = setTimeoutFn(() => {
          didTimeout = true;
          cleanup();
          reject(new Error(
            `Timed out after ${metadataTimeoutMs} ms while reading browser video metadata for audio extraction.`,
          ));
        }, metadataTimeoutMs);
      }
      video.src = objectUrl;
    });
  };
}

export function createFfmpegWasmAudioExtractor({
  ffmpeg,
  fetchFile,
  durationProbe,
  maxDurationSeconds = DEFAULT_BROWSER_EXTRACTION_MAX_DURATION_SECONDS,
  maxInputBytes = DEFAULT_BROWSER_EXTRACTION_MAX_INPUT_BYTES,
  releaseAfterRun = false,
} = {}) {
  return async function extractWithFfmpegWasm(file, onProgress = () => {}) {
    if (Number.isFinite(file?.size) && file.size > maxInputBytes) {
      throw new Error(
        `Browser ffmpeg.wasm extraction is limited to input files up to ${formatBytes(maxInputBytes)}. ` +
        "Use the Python fallback for larger videos.",
      );
    }

    let durationSeconds;
    try {
      durationSeconds = await resolveDurationSeconds(file, durationProbe);
    } catch (error) {
      throw new Error(
        `Browser ffmpeg.wasm audio extraction could not read video duration for ${file?.name || "the selected video"}. ` +
        "Use the Python fallback for this video.",
        { cause: error },
      );
    }
    if (Number.isFinite(durationSeconds) && durationSeconds > maxDurationSeconds) {
      throw new Error(
        `Browser ffmpeg.wasm extraction is limited to short videos up to ${maxDurationSeconds} seconds. ` +
        "Use the Python fallback for longer videos.",
      );
    }

    if (!ffmpeg || typeof ffmpeg.FS !== "function" || typeof ffmpeg.run !== "function") {
      throw new Error("A loaded-compatible ffmpeg.wasm instance is required for browser audio extraction.");
    }
    if (typeof fetchFile !== "function") {
      throw new Error("ffmpeg.wasm audio extraction requires a fetchFile helper.");
    }

    onProgress(5);
    if (typeof ffmpeg.isLoaded !== "function" || !ffmpeg.isLoaded()) {
      if (typeof ffmpeg.load !== "function") {
        throw new Error("ffmpeg.wasm audio extraction requires an ffmpeg.load() method.");
      }
      await ffmpeg.load();
    }

    let inputBytes;
    try {
      inputBytes = await fetchFile(file);
    } catch (error) {
      if (releaseAfterRun) {
        await releaseFfmpegRuntime(ffmpeg);
      }
      throw new Error(
        `Browser ffmpeg.wasm audio extraction could not load ${file?.name || "the selected video"} into browser memory. ` +
        "Use the Python fallback for this video.",
        { cause: error },
      );
    }
    if (Number.isFinite(inputBytes?.byteLength) && inputBytes.byteLength > maxInputBytes) {
      if (releaseAfterRun) {
        await releaseFfmpegRuntime(ffmpeg);
      }
      throw new Error(
        `Browser ffmpeg.wasm extraction received ${formatBytes(inputBytes.byteLength)} after loading the input. ` +
        `The browser limit is ${formatBytes(maxInputBytes)}; use the Python fallback for larger videos.`,
      );
    }
    onProgress(20);
    ffmpeg.FS("writeFile", FFMPEG_INPUT_NAME, inputBytes);

    try {
      try {
        await ffmpeg.run(
          "-i",
          FFMPEG_INPUT_NAME,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "wav",
          FFMPEG_OUTPUT_NAME,
        );
      } catch (error) {
        throw new Error(
          `Browser ffmpeg.wasm audio extraction failed for ${file?.name || "the selected video"}. ` +
          "Use the Python fallback for this video.",
          { cause: error },
        );
      }
      onProgress(85);
      const outputBytes = ffmpeg.FS("readFile", FFMPEG_OUTPUT_NAME);
      if (!Number.isFinite(outputBytes?.byteLength) || outputBytes.byteLength === 0) {
        throw new Error(
          `Browser ffmpeg.wasm audio extraction produced no audio bytes for ${file?.name || "the selected video"}. ` +
          "Use the Python fallback for this video.",
        );
      }
      const audioBlob = new Blob([outputBytes], { type: "audio/wav" });
      onProgress(100);

      return {
        audioBlob,
        audioFileName: makeWavFileName(file?.name || "audio.mp4"),
        audioSizeBytes: outputBytes.byteLength,
        mimeType: "audio/wav",
        sampleRate: 16000,
        channelCount: 1,
      };
    } finally {
      unlinkIfPresent(ffmpeg, FFMPEG_INPUT_NAME);
      unlinkIfPresent(ffmpeg, FFMPEG_OUTPUT_NAME);
      if (releaseAfterRun) {
        await releaseFfmpegRuntime(ffmpeg);
      }
    }
  };
}

function makeWavFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, "") + ".wav";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

async function resolveDurationSeconds(file, durationProbe) {
  if (Number.isFinite(file?.durationSeconds)) {
    return file.durationSeconds;
  }
  if (typeof durationProbe === "function") {
    return durationProbe(file);
  }
  return undefined;
}

function unlinkIfPresent(ffmpeg, path) {
  try {
    ffmpeg.FS("unlink", path);
  } catch {
    // ffmpeg.wasm throws when the file was never written; cleanup should stay best-effort.
  }
}

async function releaseFfmpegRuntime(ffmpeg) {
  if (typeof ffmpeg.terminate === "function") {
    await ffmpeg.terminate();
    return;
  }
  if (typeof ffmpeg.exit === "function") {
    await ffmpeg.exit();
  }
}

export function createClientAudioExtractor({
  environment = globalThis,
  ffmpegWasmExtractor,
} = {}) {
  return {
    capabilities: detectClientAudioExtractionCapabilities(environment),

    async extractAudio(file, onProgress = () => {}) {
      const capabilities = detectClientAudioExtractionCapabilities(environment);

      if (typeof ffmpegWasmExtractor === "function") {
        onProgress(0);
        const extracted = await ffmpegWasmExtractor(file, onProgress);
        return {
          ...extracted,
          strategy: "ffmpeg.wasm",
          fallbackUsed: true,
        };
      }

      if (capabilities.webCodecs) {
        throw new Error("WebCodecs audio extraction is detected but not implemented yet; configure ffmpeg.wasm or use the Python fallback.");
      }

      throw new Error("Browser audio extraction requires WebCodecs or a configured ffmpeg.wasm fallback.");
    },
  };
}
