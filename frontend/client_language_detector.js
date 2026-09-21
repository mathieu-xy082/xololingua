import { prepareBrowserPcmAudio } from "./browser_audio_pcm.js";
import {
  aggregateLanguageDetections,
  createLanguageDetectionSamples,
} from "./browser_language_detection.js";
import { mapClientMlProgress } from "./client_ml_progress.js";
import { createWorkerRequestSession } from "./worker_request_session.js";

const DEFAULT_MODEL_ID = "Xenova/whisper-base";

export function detectClientLanguageCapabilities(environment = globalThis) {
  const worker = typeof environment?.Worker === "function";
  return {
    worker,
    webGpu: Boolean(environment?.navigator?.gpu),
    wasm: worker,
    strategy: worker ? "whisper-transformers.js" : "unavailable",
  };
}

export function createClientLanguageDetector({
  environment = globalThis,
  detectorWorker,
  workerUrl,
  modelId = DEFAULT_MODEL_ID,
  modelResolver,
  remoteModels = false,
  dtype = "q4",
  devicePreference = "auto",
  sampleCount = 10,
  sampleSeconds = 30,
  confidenceThreshold = 0.5,
  maxWorkerResponseMs,
} = {}) {
  let activeSession;

  const cancel = () => {
    if (!activeSession) return;
    const error = new Error("Browser language detection cancelled.");
    error.cancelled = true;
    activeSession.close(error);
    activeSession = undefined;
  };

  const runWorker = async ({ audio, device }, onProgress) => {
    const samples = createLanguageDetectionSamples(
      audio.pcm,
      audio.sampleRate || audio.sampleRateHz,
      { sampleCount, sampleSeconds },
    );
    onProgress({
      stage: "preparing-language-samples",
      progress: 100,
      message: `${samples.length} language samples prepared in browser memory.`,
    });

    const model = typeof modelResolver === "function"
      ? modelResolver({ sourceLanguage: "auto" }) || {}
      : {};
    const request = {
      samples,
      sampleRate: audio.sampleRate || audio.sampleRateHz,
      modelId: model.modelId || modelId,
      dtype: model.dtype || dtype,
      remoteModels: model.remote ?? remoteModels,
      device,
    };

    if (typeof detectorWorker === "function") {
      return detectorWorker(request, onProgress);
    }
    const session = createWorkerRequestSession({
      environment,
      workerUrl,
      defaultFailureMessage: "Browser language detection worker failed.",
      closedMessage: "Browser language detection worker is closed.",
      busyMessage: "Browser language detection worker is already processing a request.",
    });
    if (!session) {
      throw new Error("Browser language detection requires a module Web Worker.");
    }
    activeSession = session;
    try {
      return await session.request({
        requestType: "detect-language",
        resultType: "language-result",
        request,
        transfer: samples.map((sample) => sample.pcm.buffer),
        onProgress,
        timeoutMs: maxWorkerResponseMs,
        timeoutMessage: `Browser language detection reported no progress for ${maxWorkerResponseMs}ms.`,
        failureMessage: "Browser language detection worker failed.",
      });
    } finally {
      session.close();
      if (activeSession === session) activeSession = undefined;
    }
  };

  return {
    capabilities: detectClientLanguageCapabilities(environment),
    cancel,

    async detectLanguage({ audio }, onProgress = () => {}) {
      onProgress({
        stage: "decoding-language-audio",
        progress: 1,
        message: "Decoding extracted audio for language detection...",
      });
      const decodedAudio = await prepareBrowserPcmAudio(audio, environment, { required: true });
      onProgress({
        stage: "decoding-language-audio",
        progress: 100,
        message: "Extracted audio decoded in browser memory.",
      });

      let activeExecutionDevice;
      const reportProgress = (event) => {
        if (event?.stage === "inference-runtime" && event.device) {
          activeExecutionDevice = event.device;
        }
        onProgress(mapClientMlProgress(event, "detecting-language"));
      };
      let result;
      try {
        result = await runWorker({ audio: decodedAudio, device: devicePreference }, reportProgress);
      } catch (webGpuError) {
        if (devicePreference === "wasm" || activeExecutionDevice !== "webgpu" || webGpuError?.cancelled) {
          throw webGpuError;
        }
        reportProgress({
          stage: "inference-runtime",
          progress: 1,
          device: "wasm",
          deviceLabel: "WASM CPU",
          fallbackReason: webGpuError?.message || String(webGpuError),
          message: "The first browser inference worker failed; retrying on local WASM CPU.",
        });
        result = await runWorker({ audio: decodedAudio, device: "wasm" }, reportProgress);
      }

      const aggregate = result?.languageCode
        ? result
        : aggregateLanguageDetections(result?.detections);
      return {
        ...aggregate,
        confidence: Number(aggregate.confidence ?? aggregate.languageProbability ?? 0),
        lowConfidence: Number(aggregate.confidence ?? aggregate.languageProbability ?? 0) < confidenceThreshold,
        strategy: "whisper-transformers.js",
      };
    },
  };
}
