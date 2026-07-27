import { env, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.min.js";

const DEFAULT_MODEL_ID = "Xenova/whisper-tiny";
const DEFAULT_SAMPLE_RATE = 16_000;

// Browser real-model mode must be explicit/local. The bootstrap workflow is
// responsible for placing compatible Transformers.js assets under this root.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "../models/";
env.backends.onnx.wasm.wasmPaths = "/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/";

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
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function warmupRecognizer({ modelId = DEFAULT_MODEL_ID, sampleSeconds = 1, sourceLanguage = "auto" } = {}) {
  self.postMessage({ type: "progress", event: { stage: "asr-warmup", progress: 5, message: "Loading local ASR model..." } });
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
  const recognizer = await getRecognizer(modelId);
  const audioInput = await resolveAudioInput(request);
  const sourceLanguage = normalizeLanguageCode(request.sourceLanguage);
  const vadSegments = Array.isArray(request.segments) ? request.segments : [];
  const sampleRate = Number(request.audio?.sampleRate || request.audio?.sampleRateHz || DEFAULT_SAMPLE_RATE);
  const segments = audioInput instanceof Float32Array && vadSegments.length > 0
    ? await transcribeVadSegments({ recognizer, audioInput, sampleRate, segments: vadSegments, sourceLanguage })
    : await transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage });

  return {
    strategy: "whisper-transformers.js",
    language: sourceLanguage || "unknown",
    segments: segments.filter((segment) => segment.text || segment.end > segment.start),
  };
}

async function transcribeVadSegments({ recognizer, audioInput, sampleRate, segments, sourceLanguage }) {
  const transcribed = [];
  for (const [offset, segment] of segments.entries()) {
    const pcmSlice = slicePcmForSegment(audioInput, sampleRate, segment);
    const output = await recognizer(pcmSlice, createWhisperOptions({ sourceLanguage, returnTimestamps: false }));
    transcribed.push({
      index: segment.index ?? offset + 1,
      start: Number(segment.start || 0),
      end: Number(segment.end || segment.start || 0),
      text: extractWhisperText(output),
    });
  }
  return transcribed;
}

async function transcribeWholeAudio({ recognizer, audioInput, request, sourceLanguage }) {
  const output = await recognizer(audioInput, createWhisperOptions({ sourceLanguage, returnTimestamps: true }));
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
