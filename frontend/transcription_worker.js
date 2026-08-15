import { env, ModelRegistry, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.min.js";

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

async function warmupRecognizer({ modelId = DEFAULT_MODEL_ID, sampleSeconds = 1, sourceLanguage = "auto", remoteModels = false } = {}) {
  configureModelSource(remoteModels);
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 5, message: "Loading ASR model..." } });
  const recognizer = await getRecognizer(modelId);
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 70, message: "Running ASR warmup sample..." } });
  const sampleLength = Math.max(1, Math.round(DEFAULT_SAMPLE_RATE * Math.max(0.1, sampleSeconds)));
  await recognizer(new Float32Array(sampleLength), createWhisperOptions({ sourceLanguage }));
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 100, message: "ASR model warmup complete." } });
  return {
    modelId,
    warmed: true,
    sampleSeconds,
    localModelPath: env.localModelPath,
  };
}

async function transcribeAudio(request = {}) {
  const modelId = request.modelId || DEFAULT_MODEL_ID;
  configureModelSource(request.remoteModels);
  const recognizer = await getRecognizer(modelId);
  const audioInput = await resolveAudioInput(request);
  const sourceLanguage = normalizeLanguageCode(request.sourceLanguage);
  const vadSegments = Array.isArray(request.segments) ? request.segments : [];
  const sampleRate = Number(request.audio?.sampleRate || request.audio?.sampleRateHz || DEFAULT_SAMPLE_RATE);
  const segments = audioInput instanceof Float32Array && vadSegments.length > 0
    ? await transcribeVadSegments({ recognizer, audioInput, sampleRate, segments: vadSegments, sourceLanguage })
    : await transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage });

  const result = {
    strategy: "whisper-transformers.js",
    language: sourceLanguage || "unknown",
    segments: segments.filter((segment) => segment.text || segment.end > segment.start),
  };
  if (request.purgeAfterUse) {
    result.metadata = await releaseRecognizer(modelId, true);
  }
  return result;
}

async function transcribeVadSegments({ recognizer, audioInput, sampleRate, segments, sourceLanguage }) {
  const transcribed = [];
  reportTranscriptionProgress(1, `Transcribing speech segment 1/${segments.length}...`);
  for (const [offset, segment] of segments.entries()) {
    const pcmSlice = slicePcmForSegment(audioInput, sampleRate, segment);
    const output = await recognizer(pcmSlice, createWhisperOptions({ sourceLanguage, returnTimestamps: false }));
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
        ? `Transcribed ${completed}/${segments.length} speech segments; processing segment ${completed + 1}...`
        : `Transcribed all ${segments.length} speech segments.`,
    );
  }
  return transcribed;
}

async function transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage }) {
  reportTranscriptionProgress(1, "Transcribing speech audio...");
  const output = await recognizer(audioInput, createWhisperOptions({ sourceLanguage, returnTimestamps: true }));
  reportTranscriptionProgress(100, "Speech transcription complete.");
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (chunks.length > 0) {
    return chunks.map((chunk, index) => ({
      index: index + 1,
      start: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0] || 0) : 0,
      end: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[1] || chunk.timestamp[0] || 0) : 0,
      text: String(chunk.text || "").trim(),
    }));
  }
  return [{
    index: 1,
    start: 0,
    end: Number(request.audio?.durationSeconds || 0),
    text: extractWhisperText(output),
  }];
}

function reportTranscriptionProgress(progress, message) {
  self.postMessage({
    type: "progress",
    event: {
      stage: "transcribing",
      progress,
      transcriptionProgress: progress,
      message,
    },
  });
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

async function getRecognizer(modelId) {
  if (!recognizerPromise || recognizerModelId !== modelId) {
    recognizerModelId = modelId;
    recognizerPromise = pipeline("automatic-speech-recognition", modelId, {
      dtype: "q4",
      progress_callback: (progress) => {
        self.postMessage({ type: "progress", event: { stage: "loading-model", ...progress } });
      },
    });
  }
  return recognizerPromise;
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
    recognizer = await pending;
  } catch {
    // A partial download may still have populated the Transformers.js cache.
  }
  if (recognizer && typeof recognizer.dispose === "function") {
    await recognizer.dispose();
  }
  recognizerPromise = undefined;
  recognizerModelId = undefined;
  if (purgeCache && typeof ModelRegistry?.clear_pipeline_cache === "function") {
    let report;
    try {
      report = await ModelRegistry.clear_pipeline_cache("automatic-speech-recognition", modelId, { dtype: "q4" });
    } catch (error) {
      return { cachePurged: false, filesDeleted: 0, purgeError: error?.message || String(error) };
    }
    return { cachePurged: true, filesDeleted: report?.filesDeleted || 0 };
  }
  return { cachePurged: false, filesDeleted: 0 };
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
