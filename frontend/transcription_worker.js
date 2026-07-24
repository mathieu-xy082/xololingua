import { env, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.web.min.js";

const DEFAULT_MODEL_ID = "Xenova/whisper-tiny";
const DEFAULT_SAMPLE_RATE = 16_000;

// Browser real-model mode must be explicit/local. The bootstrap workflow is
// responsible for placing compatible Transformers.js assets under this root.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "models/";
env.backends.onnx.wasm.wasmPaths = "../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/";

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
  const output = await recognizer(audioInput, createWhisperOptions({ sourceLanguage }));
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const segments = chunks.length > 0
    ? chunks.map((chunk, index) => ({
        index: index + 1,
        start: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0] || 0) : 0,
        end: Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[1] || chunk.timestamp[0] || 0) : 0,
        text: String(chunk.text || "").trim(),
      }))
    : [{
        index: 1,
        start: 0,
        end: Number(request.audio?.durationSeconds || 0),
        text: String(output?.text || "").trim(),
      }];

  return {
    strategy: "whisper-transformers.js",
    language: sourceLanguage || output?.language || "unknown",
    segments: segments.filter((segment) => segment.text || segment.end > segment.start),
  };
}

async function getRecognizer(modelId) {
  if (!recognizerPromise || recognizerModelId !== modelId) {
    recognizerModelId = modelId;
    recognizerPromise = pipeline("automatic-speech-recognition", modelId, {
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

function createWhisperOptions({ sourceLanguage } = {}) {
  const language = normalizeLanguageCode(sourceLanguage);
  return {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    ...(language && language !== "auto" ? { language } : {}),
    task: "transcribe",
  };
}

function normalizeLanguageCode(language) {
  if (typeof language === "string") return language;
  if (typeof language?.code === "string") return language.code;
  return "auto";
}
