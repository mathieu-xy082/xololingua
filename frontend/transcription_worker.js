import { env, ModelRegistry, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.min.js";
import { createRuntimeMetadata, loadPipelineWithDeviceFallback } from "./browser_inference_device.js";

const DEFAULT_MODEL_ID = "Xenova/whisper-base";
const DEFAULT_SAMPLE_RATE = 16_000;

// Production requests download Whisper on demand. Local models remain
// available for deterministic and offline validation runs.
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;
env.localModelPath = "../models/";
env.backends.onnx.wasm.wasmPaths = "/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/";
const transformersFetch = env.fetch;
env.fetch = (input, init = {}) => transformersFetch(input, withTransientRemoteCache(input, init));

let recognizerPromise;
let recognizerModelId;
let recognizerDevicePreference;
let recognizerRuntime;

self.onmessage = async (event) => {
  const message = event?.data || {};
  try {
    if (message.type === "warmup") {
      const metadata = await warmupRecognizer(message.request || {});
      self.postMessage({ type: "warmup-complete", metadata });
      return;
    }

    if (message.type === "transcribe") {
      const result = await transcribeAudio(message.request || {});
      self.postMessage({ type: "result", result });
      return;
    }

    if (message.type === "dispose") {
      const request = message.request || {};
      const metadata = await releaseRecognizer(
        request.modelId || recognizerModelId || DEFAULT_MODEL_ID,
        request.purgeCache !== false,
      );
      self.postMessage({ type: "dispose-complete", metadata });
      return;
    }

    throw new Error(`Unsupported transcription worker message type: ${message.type || "unknown"}.`);
  } catch (error) {
    if (message.request?.purgeAfterUse || message.request?.purgeOnError) {
      await releaseRecognizer(message.request.modelId || DEFAULT_MODEL_ID, true);
    }
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function warmupRecognizer({ modelId = DEFAULT_MODEL_ID, sampleSeconds = 1, sourceLanguage = "auto", remoteModels = false, device = "auto" } = {}) {
  const warmupStartedAt = nowMs();
  configureModelSource(remoteModels);
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 5, message: "Loading ASR model..." } });
  const modelLoadStartedAt = nowMs();
  const stopModelHeartbeat = startModelPreparationHeartbeat("Whisper");
  let recognizer;
  try {
    recognizer = await getRecognizer(modelId, device);
  } finally {
    stopModelHeartbeat();
  }
  const modelLoadMs = elapsedMs(modelLoadStartedAt);
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 70, message: "Running ASR warmup sample..." } });
  const sampleLength = Math.max(1, Math.round(DEFAULT_SAMPLE_RATE * Math.max(0.1, sampleSeconds)));
  const inferenceStartedAt = nowMs();
  await recognizer(new Float32Array(sampleLength), createWhisperOptions({ sourceLanguage }));
  const warmupInferenceMs = elapsedMs(inferenceStartedAt);
  const warmupTotalMs = elapsedMs(warmupStartedAt);
  self.postMessage({
    type: "progress",
    event: {
      stage: "asr-warmup",
      progress: 100,
      message: `ASR warmup complete in ${formatSeconds(warmupTotalMs)} (model ${formatSeconds(modelLoadMs)}, inference ${formatSeconds(warmupInferenceMs)}).`,
      timings: { modelLoadMs, warmupInferenceMs, warmupTotalMs },
    },
  });
  return {
    modelId,
    warmed: true,
    sampleSeconds,
    localModelPath: env.localModelPath,
    timings: { modelLoadMs, warmupInferenceMs, warmupTotalMs },
    ...createRuntimeMetadata(recognizerRuntime),
  };
}

async function transcribeAudio(request = {}) {
  const requestStartedAt = nowMs();
  const modelId = request.modelId || DEFAULT_MODEL_ID;
  configureModelSource(request.remoteModels);
  const recognizer = await getRecognizer(modelId, request.device || "auto");
  const inputStartedAt = nowMs();
  const audioInput = await resolveAudioInput(request);
  const inputPreparationMs = elapsedMs(inputStartedAt);
  const sourceLanguage = normalizeLanguageCode(request.sourceLanguage);
  const vadSegments = Array.isArray(request.segments) ? request.segments : [];
  const sampleRate = Number(request.audio?.sampleRate || request.audio?.sampleRateHz || DEFAULT_SAMPLE_RATE);
  const transcription = audioInput instanceof Float32Array && vadSegments.length > 0
    ? await transcribeVadSegments({ recognizer, audioInput, sampleRate, segments: vadSegments, sourceLanguage })
    : await transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage });

  const result = {
    strategy: "whisper-transformers.js",
    language: sourceLanguage || "unknown",
    segments: transcription.segments.filter((segment) => segment.text || segment.end > segment.start),
    metadata: {
      ...createRuntimeMetadata(recognizerRuntime),
      timings: {
        ...transcription.timings,
        inputPreparationMs,
      },
    },
  };
  if (request.purgeAfterUse) {
    const cleanupStartedAt = nowMs();
    const releaseMetadata = await releaseRecognizer(modelId, true);
    result.metadata = {
      ...result.metadata,
      ...releaseMetadata,
      timings: {
        ...result.metadata.timings,
        cleanupMs: elapsedMs(cleanupStartedAt),
        requestTotalMs: elapsedMs(requestStartedAt),
      },
    };
  } else {
    result.metadata.timings.requestTotalMs = elapsedMs(requestStartedAt);
  }
  return result;
}

async function transcribeVadSegments({ recognizer, audioInput, sampleRate, segments, sourceLanguage }) {
  const transcriptionStartedAt = nowMs();
  const transcribed = [];
  const segmentTimings = [];
  let totalInferenceMs = 0;
  let totalPreparationMs = 0;
  let totalAudioSeconds = 0;
  reportTranscriptionProgress(1, `Transcribing speech segment 1/${segments.length}...`);
  for (const [offset, segment] of segments.entries()) {
    const preparationStartedAt = nowMs();
    const pcmSlice = slicePcmForSegment(audioInput, sampleRate, segment);
    const preparationMs = elapsedMs(preparationStartedAt);
    const audioSeconds = pcmSlice.length / sampleRate;
    const inferenceStartedAt = nowMs();
    const output = await recognizer(pcmSlice, createWhisperOptions({ sourceLanguage, returnTimestamps: false }));
    const inferenceMs = elapsedMs(inferenceStartedAt);
    const realtimeFactor = calculateRealtimeFactor(inferenceMs, audioSeconds);
    totalPreparationMs += preparationMs;
    totalInferenceMs += inferenceMs;
    totalAudioSeconds += audioSeconds;
    segmentTimings.push({
      index: segment.index ?? offset + 1,
      audioSeconds: roundMetric(audioSeconds),
      preparationMs,
      inferenceMs,
      realtimeFactor,
    });
    transcribed.push({
      index: segment.index ?? offset + 1,
      start: Number(segment.start || 0),
      end: Number(segment.end || segment.start || 0),
      text: extractWhisperText(output),
    });
    const completed = offset + 1;
    reportTranscriptionProgress(
      Math.round((completed / Math.max(1, segments.length)) * 100),
      completed < segments.length
        ? `Transcribed ${completed}/${segments.length} speech segments in ${formatSeconds(inferenceMs)} (${realtimeFactor.toFixed(2)}× realtime); processing segment ${completed + 1}...`
        : `Transcribed all ${segments.length} speech segments in ${formatSeconds(totalInferenceMs)} (${calculateRealtimeFactor(totalInferenceMs, totalAudioSeconds).toFixed(2)}× realtime).`,
      {
        completedSegments: completed,
        segmentCount: segments.length,
        segmentInferenceMs: inferenceMs,
        segmentAudioSeconds: roundMetric(audioSeconds),
        segmentRealtimeFactor: realtimeFactor,
        totalInferenceMs: roundMetric(totalInferenceMs),
        totalAudioSeconds: roundMetric(totalAudioSeconds),
      },
    );
  }
  return {
    segments: transcribed,
    timings: {
      mode: "vad-segments",
      segmentCount: segments.length,
      audioSeconds: roundMetric(totalAudioSeconds),
      preparationMs: roundMetric(totalPreparationMs),
      inferenceMs: roundMetric(totalInferenceMs),
      transcriptionWallMs: elapsedMs(transcriptionStartedAt),
      realtimeFactor: calculateRealtimeFactor(totalInferenceMs, totalAudioSeconds),
      segments: segmentTimings,
    },
  };
}

async function transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage }) {
  const transcriptionStartedAt = nowMs();
  const audioSeconds = audioInput instanceof Float32Array
    ? audioInput.length / Number(request.audio?.sampleRate || request.audio?.sampleRateHz || DEFAULT_SAMPLE_RATE)
    : Number(request.audio?.durationSeconds || 0);
  reportTranscriptionProgress(1, "Transcribing speech audio...");
  const inferenceStartedAt = nowMs();
  const output = await recognizer(audioInput, createWhisperOptions({ sourceLanguage, returnTimestamps: true }));
  const inferenceMs = elapsedMs(inferenceStartedAt);
  const realtimeFactor = calculateRealtimeFactor(inferenceMs, audioSeconds);
  reportTranscriptionProgress(
    100,
    `Speech transcription complete in ${formatSeconds(inferenceMs)} (${realtimeFactor.toFixed(2)}× realtime).`,
    { inferenceMs, audioSeconds: roundMetric(audioSeconds), realtimeFactor },
  );
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (chunks.length > 0) {
    return {
      segments: chunks.map((chunk, index) => ({
        index: index + 1,
        start: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0] || 0) : 0,
        end: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[1] || chunk.timestamp[0] || 0) : 0,
        text: String(chunk.text || "").trim(),
      })),
      timings: createWholeAudioTimings({ audioSeconds, inferenceMs, transcriptionStartedAt }),
    };
  }
  return {
    segments: [{
      index: 1,
      start: 0,
      end: Number(request.audio?.durationSeconds || 0),
      text: extractWhisperText(output),
    }],
    timings: createWholeAudioTimings({ audioSeconds, inferenceMs, transcriptionStartedAt }),
  };
}

function reportTranscriptionProgress(progress, message, details = {}) {
  self.postMessage({
    type: "progress",
    event: {
      stage: "transcribing",
      progress,
      transcriptionProgress: progress,
      message,
      ...details,
    },
  });
}

function createWholeAudioTimings({ audioSeconds, inferenceMs, transcriptionStartedAt }) {
  return {
    mode: "whole-audio",
    segmentCount: 1,
    audioSeconds: roundMetric(audioSeconds),
    preparationMs: 0,
    inferenceMs,
    transcriptionWallMs: elapsedMs(transcriptionStartedAt),
    realtimeFactor: calculateRealtimeFactor(inferenceMs, audioSeconds),
  };
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt) {
  return roundMetric(Math.max(0, nowMs() - startedAt));
}

function calculateRealtimeFactor(inferenceMs, audioSeconds) {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return 0;
  return roundMetric((inferenceMs / 1000) / audioSeconds);
}

function roundMetric(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function startModelPreparationHeartbeat(label) {
  const startedAt = nowMs();
  const timer = setInterval(() => {
    self.postMessage({
      type: "progress",
      event: {
        stage: "loading-model",
        progress: 5,
        message: `${label} download or compilation is still active — ${formatSeconds(elapsedMs(startedAt))} elapsed.`,
      },
    });
  }, 5_000);
  return () => clearInterval(timer);
}

function slicePcmForSegment(audioInput, sampleRate, segment) {
  const startSample = Math.max(0, Math.floor(Number(segment.start || 0) * sampleRate));
  const endSample = Math.max(startSample, Math.ceil(Number(segment.end || segment.start || 0) * sampleRate));
  return audioInput.slice(startSample, Math.min(audioInput.length, endSample));
}

function extractWhisperText(output) {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output?.chunks) && output.chunks.length > 0) {
    return output.chunks.map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join(" ").trim();
  }
  return String(output?.text || "").trim();
}

async function getRecognizer(modelId, devicePreference = "auto") {
  if (!recognizerPromise || recognizerModelId !== modelId || recognizerDevicePreference !== devicePreference) {
    recognizerModelId = modelId;
    recognizerDevicePreference = devicePreference;
    recognizerPromise = loadPipelineWithDeviceFallback({
      createPipeline: pipeline,
      task: "automatic-speech-recognition",
      modelId,
      dtype: "q4",
      devicePreference,
      environment: self,
      pipelineOptions: {
        progress_callback: (progress) => {
          self.postMessage({ type: "progress", event: { stage: "loading-model", ...progress } });
        },
      },
      onLifecycle: (event) => self.postMessage({ type: "progress", event }),
    });
  }
  const loaded = await recognizerPromise;
  recognizerRuntime = loaded.runtime;
  return loaded.pipeline;
}

function configureModelSource(remoteModels) {
  env.allowRemoteModels = Boolean(remoteModels);
  env.allowLocalModels = !remoteModels;
  env.useBrowserCache = true;
}

function withTransientRemoteCache(input, init) {
  const url = typeof input === "string" ? input : input?.url || String(input);
  return url.startsWith(env.remoteHost) ? { ...init, cache: "no-store" } : init;
}

async function releaseRecognizer(modelId, purgeCache) {
  const pending = recognizerPromise;
  let recognizer = null;
  try {
    recognizer = (await pending)?.pipeline;
  } catch {
    // A partial download may still have populated the Transformers.js cache.
  }
  if (recognizer && typeof recognizer.dispose === "function") {
    await recognizer.dispose();
  }
  recognizerPromise = undefined;
  recognizerModelId = undefined;
  recognizerDevicePreference = undefined;
  const runtimeMetadata = createRuntimeMetadata(recognizerRuntime);
  recognizerRuntime = undefined;
  if (purgeCache && typeof ModelRegistry?.clear_pipeline_cache === "function") {
    let report;
    try {
      report = await ModelRegistry.clear_pipeline_cache("automatic-speech-recognition", modelId, { dtype: "q4" });
    } catch (error) {
      return { ...runtimeMetadata, cachePurged: false, filesDeleted: 0, purgeError: error?.message || String(error) };
    }
    return { ...runtimeMetadata, cachePurged: true, filesDeleted: report?.filesDeleted || 0 };
  }
  return { ...runtimeMetadata, cachePurged: false, filesDeleted: 0 };
}

async function resolveAudioInput(request) {
  if (request.audio?.pcm instanceof Float32Array) {
    return request.audio.pcm;
  }
  if (request.audio?.audioBlob instanceof Blob) {
    return URL.createObjectURL(request.audio.audioBlob);
  }
  if (request.audioBlob instanceof Blob) {
    return URL.createObjectURL(request.audioBlob);
  }
  if (typeof request.audioUrl === "string") {
    return request.audioUrl;
  }
  if (request.audio?.audioUrl) {
    return request.audio.audioUrl;
  }
  throw new Error("Browser ASR requires browser audio PCM, Blob, or URL; server audioId alone cannot be transcribed in the browser.");
}

function createWhisperOptions({ sourceLanguage, returnTimestamps = true } = {}) {
  const language = normalizeLanguageCode(sourceLanguage);
  return {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: returnTimestamps,
    ...(language && language !== "auto" ? { language } : {}),
    task: "transcribe",
  };
}

function normalizeLanguageCode(language) {
  if (typeof language === "string") return language;
  if (typeof language?.code === "string") return language.code;
  return "auto";
}
