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
const FFMPEG_INPUT_NAME = "input.mp4";
const FFMPEG_OUTPUT_NAME = "output.wav";

export function createBrowserVideoDurationProbe(environment = globalThis) {
  return function probeBrowserVideoDuration(file) {
    if (typeof environment.document?.createElement !== "function" ||
        typeof environment.URL?.createObjectURL !== "function" ||
        typeof environment.URL?.revokeObjectURL !== "function") {
      throw new Error("Browser video duration probing requires document and URL object URL APIs.");
    }

    const video = environment.document.createElement("video");
    const objectUrl = environment.URL.createObjectURL(file);
    video.preload = "metadata";

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.src = "";
        environment.URL.revokeObjectURL(objectUrl);
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
      video.src = objectUrl;
    });
  };
}

export function createFfmpegWasmAudioExtractor({
  ffmpeg,
  fetchFile,
  durationProbe,
  maxDurationSeconds = DEFAULT_BROWSER_EXTRACTION_MAX_DURATION_SECONDS,
} = {}) {
  return async function extractWithFfmpegWasm(file, onProgress = () => {}) {
    const durationSeconds = await resolveDurationSeconds(file, durationProbe);
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

    const inputBytes = await fetchFile(file);
    onProgress(20);
    ffmpeg.FS("writeFile", FFMPEG_INPUT_NAME, inputBytes);

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
      onProgress(85);
      const outputBytes = ffmpeg.FS("readFile", FFMPEG_OUTPUT_NAME);
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
    }
  };
}

function makeWavFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, "") + ".wav";
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

export function createClientAudioExtractor({
  environment = globalThis,
  ffmpegWasmExtractor,
} = {}) {
  return {
    capabilities: detectClientAudioExtractionCapabilities(environment),

    async extractAudio(file, onProgress = () => {}) {
      const capabilities = detectClientAudioExtractionCapabilities(environment);

      if (capabilities.webCodecs) {
        throw new Error("WebCodecs audio extraction is detected but not implemented yet.");
      }

      if (typeof ffmpegWasmExtractor === "function") {
        onProgress(0);
        const extracted = await ffmpegWasmExtractor(file, onProgress);
        return {
          ...extracted,
          strategy: "ffmpeg.wasm",
          fallbackUsed: true,
        };
      }

      throw new Error("Browser audio extraction requires WebCodecs or a configured ffmpeg.wasm fallback.");
    },
  };
}
