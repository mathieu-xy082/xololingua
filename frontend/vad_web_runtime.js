const DEFAULT_VAD_MODEL_URL = "/node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx";
const DEFAULT_ORT_WASM_BASE_PATH = "/node_modules/onnxruntime-web/dist/";
const DEFAULT_VAD_MODEL = "silero-vad-legacy";
const DEFAULT_FRAME_DURATION_MS = 96;

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
} = {}) {
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
    const vad = await environment.vad.NonRealTimeVAD.new({
      modelURL,
      ortConfig: (ort) => {
        configureOrtWasmPaths({ ort }, ortWasmBasePath);
      },
    });
    if (typeof vad?.run !== "function") {
      throw new Error("vad-web NonRealTimeVAD adapter must expose a run(pcm, sampleRate) method.");
    }

    onProgress(35);
    const segments = [];
    let rawSegmentCount = 0;
    for await (const segment of vad.run(pcm, sourceSampleRate)) {
      rawSegmentCount += 1;
      segments.push({
        start: segment.start,
        end: segment.end,
      });
    }

    onProgress(100);
    return {
      segments,
      diagnostics: {
        audioFileName: audio?.audioFileName ?? audioBlob?.name ?? null,
        model,
        pcmSampleCount: pcm.length,
        rawSegmentCount,
        sourceSampleRate,
        strategy: "vad-web",
      },
      model,
      frameDurationMs,
    };
  };
}

export {
  DEFAULT_FRAME_DURATION_MS,
  DEFAULT_ORT_WASM_BASE_PATH,
  DEFAULT_VAD_MODEL,
  DEFAULT_VAD_MODEL_URL,
};
