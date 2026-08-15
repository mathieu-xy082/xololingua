const DEFAULT_VAD_MODEL_URL = "/node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx";
const DEFAULT_ORT_WASM_BASE_PATH = "/node_modules/onnxruntime-web/dist/";
const DEFAULT_VAD_MODEL = "silero-vad-legacy";
const DEFAULT_VAD_WORKER_URL = "frontend/vad_worker.js";
const DEFAULT_FRAME_DURATION_MS = 96;
const DEFAULT_MAX_SEGMENT_SECONDS = 12;
const DEFAULT_MIN_SEGMENT_SECONDS = 0.4;

const DEFAULT_VAD_FRAME_PROCESSOR_OPTIONS = Object.freeze({
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.25,
  preSpeechPadMs: 800,
  redemptionMs: 1400,
  minSpeechMs: 400,
  submitUserSpeechOnPause: false,
});

const DEFAULT_VAD_PROFILE = Object.freeze({
  name: "vad-web-default",
  description: "vad-web Silero defaults from @ricky0123/vad-web.",
  options: DEFAULT_VAD_FRAME_PROCESSOR_OPTIONS,
});

const BACKEND_COMPATIBLE_VAD_PROFILE = Object.freeze({
  name: "backend-compatible",
  description: "Conservative Silero VAD profile intended to avoid fragmenting short pauses before the 12s backend-style max segment split.",
  options: Object.freeze({
    ...DEFAULT_VAD_FRAME_PROCESSOR_OPTIONS,
    positiveSpeechThreshold: 0.35,
    negativeSpeechThreshold: 0.2,
    preSpeechPadMs: 450,
    redemptionMs: 1800,
    minSpeechMs: 400,
  }),
});

const VAD_WEB_PROFILES = Object.freeze({
  [DEFAULT_VAD_PROFILE.name]: DEFAULT_VAD_PROFILE,
  [BACKEND_COMPATIBLE_VAD_PROFILE.name]: BACKEND_COMPATIBLE_VAD_PROFILE,
});

export function detectVadWebRuntimeCapabilities(environment = globalThis) {
  const missing = [];
  if (typeof environment?.vad?.NonRealTimeVAD?.new !== "function") {
    missing.push("vad.NonRealTimeVAD");
  }
  if (typeof environment?.vad?.utils?.audioFileToArray !== "function") {
    missing.push("vad.utils.audioFileToArray");
  }
  if (!environment?.ort?.env?.wasm) {
    missing.push("ort.env.wasm");
  }

  return {
    vadWeb: missing.length === 0,
    strategy: missing.length === 0 ? "vad-web" : "unavailable",
    missing,
  };
}

export function resolveVadWebProfile(profile = DEFAULT_VAD_PROFILE.name) {
  if (profile && typeof profile === "object") {
    const options = profile.options && typeof profile.options === "object" ? profile.options : profile;
    return Object.freeze({
      name: profile.name || "custom",
      description: profile.description || "Custom browser VAD frame processor options.",
      options: Object.freeze({ ...DEFAULT_VAD_FRAME_PROCESSOR_OPTIONS, ...options }),
    });
  }
  const resolved = VAD_WEB_PROFILES[profile || DEFAULT_VAD_PROFILE.name];
  if (!resolved) {
    throw new Error(`Unknown browser VAD profile: ${profile}`);
  }
  return resolved;
}

export function configureOrtWasmPaths(
  environment = globalThis,
  wasmBasePath = DEFAULT_ORT_WASM_BASE_PATH,
) {
  if (!environment?.ort?.env?.wasm) {
    throw new Error("Browser VAD runtime requires ort.env.wasm to configure ONNX Runtime assets.");
  }

  environment.ort.env.wasm.wasmPaths = wasmBasePath;
  // Keep the first integration conservative. It avoids threaded WASM surprises while
  // still working under the COOP/COEP headers already required by ffmpeg.wasm.
  environment.ort.env.wasm.numThreads = 1;
  return environment.ort.env.wasm.wasmPaths;
}

export function createVadWebRuntimeSegmenter({
  environment = globalThis,
  modelURL = DEFAULT_VAD_MODEL_URL,
  ortWasmBasePath = DEFAULT_ORT_WASM_BASE_PATH,
  model = DEFAULT_VAD_MODEL,
  frameDurationMs = DEFAULT_FRAME_DURATION_MS,
  maxSegmentSeconds = DEFAULT_MAX_SEGMENT_SECONDS,
  minSegmentSeconds = DEFAULT_MIN_SEGMENT_SECONDS,
  vadProfile = DEFAULT_VAD_PROFILE.name,
  workerUrl = DEFAULT_VAD_WORKER_URL,
  workerFactory,
} = {}) {
  const resolvedVadProfile = resolveVadWebProfile(vadProfile);
  return async function segmentWithVadWeb(audio, onProgress = () => {}) {
    const capabilities = detectVadWebRuntimeCapabilities(environment);
    if (!capabilities.vadWeb) {
      throw new Error(
        "Browser VAD runtime requires vad.NonRealTimeVAD, vad.utils.audioFileToArray, and ort.env.wasm; " +
        `missing: ${capabilities.missing.join(", ") || "none"}.`,
      );
    }

    const audioBlob = audio?.audioBlob ?? audio;
    if (!audioBlob) {
      throw new Error("Browser VAD runtime requires an audioBlob or Blob input from browser audio extraction.");
    }

    onProgress(0);
    const decoded = await environment.vad.utils.audioFileToArray(audioBlob);
    const pcm = decoded?.audio;
    const sourceSampleRate = decoded?.sampleRate ?? audio?.sampleRate ?? audio?.sampleRateHz;
    if (!(pcm instanceof Float32Array)) {
      throw new Error("Browser VAD runtime audio decoder must return a Float32Array at decoded.audio.");
    }
    if (typeof sourceSampleRate !== "number" || sourceSampleRate <= 0) {
      throw new Error("Browser VAD runtime audio decoder must return a positive numeric sampleRate.");
    }

    onProgress(15);
    const audioDurationSeconds = pcm.length / sourceSampleRate;
    const createWorker = resolveVadWorkerFactory(environment, workerFactory);
    const rawResult = createWorker
      ? await runVadInWorker({
          createWorker,
          workerUrl,
          pcm,
          sampleRate: sourceSampleRate,
          modelURL,
          ortWasmBasePath,
          vadOptions: resolvedVadProfile.options,
          onProgress,
        })
      : await runVadOnMainThread({
          environment,
          pcm,
          sampleRate: sourceSampleRate,
          modelURL,
          ortWasmBasePath,
          vadOptions: resolvedVadProfile.options,
          onProgress,
        });
    const segments = rawResult.segments.map((segment) => ({
        start: normalizeVadTimestamp(segment.start, {
          audioDurationSeconds,
          sampleRate: sourceSampleRate,
        }),
        end: normalizeVadTimestamp(segment.end, {
          audioDurationSeconds,
          sampleRate: sourceSampleRate,
        }),
      }));

    const boundedSegments = splitLongSegments(segments, maxSegmentSeconds, minSegmentSeconds);

    onProgress(100);
    return {
      segments: boundedSegments,
      diagnostics: {
        audioFileName: audio?.audioFileName ?? audioBlob?.name ?? null,
        model,
        pcmSampleCount: pcm.length,
        rawSegmentCount: rawResult.rawSegmentCount,
        boundedSegmentCount: boundedSegments.length,
        sourceSampleRate,
        strategy: "vad-web",
        vadOptions: resolvedVadProfile.options,
        vadProfile: resolvedVadProfile.name,
        vadProfileDescription: resolvedVadProfile.description,
      },
      model,
      frameDurationMs,
    };
  };
}

function resolveVadWorkerFactory(environment, workerFactory) {
  if (typeof workerFactory === "function") return workerFactory;
  if (typeof environment?.Worker === "function") {
    return (url) => new environment.Worker(url);
  }
  return null;
}

async function runVadOnMainThread({
  environment,
  pcm,
  sampleRate,
  modelURL,
  ortWasmBasePath,
  vadOptions,
  onProgress,
}) {
  const vad = await environment.vad.NonRealTimeVAD.new({
    modelURL,
    ...vadOptions,
    ortConfig: (ort) => {
      configureOrtWasmPaths({ ort }, ortWasmBasePath);
    },
  });
  if (typeof vad?.run !== "function") {
    throw new Error("vad-web NonRealTimeVAD adapter must expose a run(pcm, sampleRate) method.");
  }

  onProgress(35);
  const segments = [];
  for await (const segment of vad.run(pcm, sampleRate)) {
    segments.push(segment);
  }
  return { segments, rawSegmentCount: segments.length };
}

async function runVadInWorker({
  createWorker,
  workerUrl,
  pcm,
  sampleRate,
  modelURL,
  ortWasmBasePath,
  vadOptions,
  onProgress,
}) {
  const worker = createWorker(workerUrl);
  if (!worker || typeof worker.postMessage !== "function") {
    throw new Error("Browser VAD worker factory must return a Web Worker.");
  }
  const pcmBuffer = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength
    ? pcm.buffer
    : pcm.slice().buffer;

  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const message = event?.data || {};
        if (message.type === "progress") {
          onProgress(message.progress);
        } else if (message.type === "result") {
          resolve(message.result);
        } else if (message.type === "error") {
          reject(new Error(message.error || "Browser VAD worker failed."));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event?.message || "Browser VAD worker failed."));
      };
      worker.postMessage({
        type: "segment",
        request: {
          pcmBuffer,
          sampleRate,
          modelURL,
          ortWasmBasePath,
          vadOptions,
        },
      }, [pcmBuffer]);
    });
  } finally {
    worker.terminate?.();
  }
}

function normalizeVadTimestamp(value, { audioDurationSeconds, sampleRate } = {}) {
  if (typeof value !== "number") {
    return value;
  }
  if (!Number.isFinite(value) || value < 0) {
    return value;
  }
  if (typeof audioDurationSeconds === "number" && audioDurationSeconds > 0) {
    const tolerance = Math.max(1, audioDurationSeconds * 0.05);
    if (value <= audioDurationSeconds + tolerance) {
      return value;
    }
    const milliseconds = value / 1000;
    if (milliseconds <= audioDurationSeconds + tolerance) {
      return milliseconds;
    }
    if (typeof sampleRate === "number" && sampleRate > 0) {
      const samples = value / sampleRate;
      if (samples <= audioDurationSeconds + tolerance) {
        return samples;
      }
    }
  }
  return Number.isInteger(value) && value >= 1000 ? value / 1000 : value;
}

function splitLongSegments(segments, maxSegmentSeconds, minSegmentSeconds) {
  if (!Number.isFinite(maxSegmentSeconds) || maxSegmentSeconds <= 0) {
    return segments;
  }
  const bounded = [];
  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    let cursor = start;
    while (end - cursor > maxSegmentSeconds) {
      bounded.push({ start: cursor, end: cursor + maxSegmentSeconds });
      cursor += maxSegmentSeconds;
    }
    if (end - cursor >= minSegmentSeconds) {
      bounded.push({ start: cursor, end });
    }
  }
  return bounded;
}

export {
  BACKEND_COMPATIBLE_VAD_PROFILE,
  DEFAULT_FRAME_DURATION_MS,
  DEFAULT_MAX_SEGMENT_SECONDS,
  DEFAULT_MIN_SEGMENT_SECONDS,
  DEFAULT_ORT_WASM_BASE_PATH,
  DEFAULT_VAD_FRAME_PROCESSOR_OPTIONS,
  DEFAULT_VAD_MODEL,
  DEFAULT_VAD_MODEL_URL,
  DEFAULT_VAD_PROFILE,
  DEFAULT_VAD_WORKER_URL,
  VAD_WEB_PROFILES,
};
