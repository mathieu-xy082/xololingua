import { mapClientMlProgress } from "./client_ml_progress.js";
import { createWorkerRequestSession } from "./worker_request_session.js";

export function detectClientTranscriptionCapabilities(environment = globalThis) {
  const dynamicModels = Boolean(environment?.__xololinguaDynamicModels);
  const transformersJs = typeof environment?.Worker === "function";
  const webGpu = Boolean(environment?.navigator?.gpu);

  return {
    transformersJs,
    webGpu,
    ...(dynamicModels && transformersJs ? { remoteModels: true, transientModelCache: true } : {}),
    strategy: transformersJs ? dynamicModels ? "remote-transformers.js" : "transformers.js" : "unavailable",
  };
}

export function createClientTranscriber({
  environment = globalThis,
  transformerWorker,
  workerUrl,
  modelId,
  modelResolver,
  remoteModels = false,
  purgeAfterUse = false,
  devicePreference,
  warmupTimeoutMs,
  warmupSampleSeconds = 1,
  maxDurationSeconds,
  maxAudioBytes,
  maxSegments,
  maxWorkerResponseMs,
} = {}) {
  let warmupPromise;
  let warmupMetadata;
  let workerSession;

  const getWorkerSession = () => {
    if (!workerSession && workerUrl && typeof environment?.Worker === "function") {
      workerSession = createWorkerRequestSession({
        environment,
        workerUrl,
        defaultFailureMessage: "Browser transcription worker failed.",
        closedMessage: "Browser transcription worker session is closed.",
        busyMessage: "Browser transcription worker is already processing a request.",
      });
    }
    return workerSession;
  };

  const closeWorkerSession = (error) => {
    workerSession?.close(error);
    workerSession = undefined;
    warmupPromise = undefined;
    warmupMetadata = undefined;
  };

  const ensureWarmup = async (request, onProgress) => {
    const model = resolveModelRequest({ request, modelId, modelResolver, remoteModels, purgeAfterUse, devicePreference });
    if (!model.modelId || !workerUrl || typeof environment?.Worker !== "function") {
      return undefined;
    }
    if (!warmupPromise) {
      const session = getWorkerSession();
      warmupPromise = session.request({
        requestType: "warmup",
        resultType: "warmup-complete",
        request: {
          modelId: model.modelId,
          ...(model.dtype ? { dtype: model.dtype } : {}),
          sampleSeconds: warmupSampleSeconds,
          sourceLanguage: request?.sourceLanguage || "auto",
          ...(model.remoteModels ? { remoteModels: true } : {}),
          ...(model.purgeAfterUse ? { purgeOnError: true } : {}),
          ...(model.device ? { device: model.device } : {}),
        },
        onProgress,
        timeoutMs: warmupTimeoutMs,
        timeoutMessage: `Browser transcription warmup timed out after ${warmupTimeoutMs}ms.`,
        failureMessage: "Browser transcription warmup failed.",
      }).then((metadata) => {
        warmupMetadata = metadata || {};
        return warmupMetadata;
      }).catch((error) => {
        closeWorkerSession();
        throw error;
      });
    }
    return warmupPromise;
  };

  const cancel = () => {
    if (!workerSession) return;
    const error = new Error("Browser transcription cancelled.");
    error.cancelled = true;
    closeWorkerSession(error);
  };

  return {
    capabilities: detectClientTranscriptionCapabilities(environment),
    cancel,

    async transcribeAudio(request, onProgress = () => {}) {
      if (
        Number.isFinite(maxDurationSeconds)
        && Number.isFinite(request?.audio?.durationSeconds)
        && request.audio.durationSeconds > maxDurationSeconds
      ) {
        throw new Error(`Browser transcription limit exceeded: audio duration ${request.audio.durationSeconds}s is greater than the ${maxDurationSeconds}s limit.`);
      }

      if (
        Number.isFinite(maxAudioBytes)
        && Number.isFinite(request?.audio?.sizeBytes)
        && request.audio.sizeBytes > maxAudioBytes
      ) {
        const byteLabel = maxAudioBytes === 1 ? "byte" : "bytes";
        throw new Error(`Browser transcription limit exceeded: audio size ${request.audio.sizeBytes} bytes is greater than the ${maxAudioBytes} ${byteLabel} limit.`);
      }

      const segmentCount = request?.segments?.length || 0;
      if (
        Number.isFinite(maxSegments)
        && segmentCount > maxSegments
      ) {
        const segmentLabel = maxSegments === 1 ? "segment" : "segments";
        throw new Error(`Browser transcription limit exceeded: ${segmentCount} segments is greater than the ${maxSegments} ${segmentLabel} limit.`);
      }

      const model = resolveModelRequest({ request, modelId, modelResolver, remoteModels, purgeAfterUse, devicePreference });
      await ensureWarmup(request, (event) => onProgress(mapClientMlProgress(event, "asr-warmup")));

      const transcribe = typeof transformerWorker === "function"
        ? transformerWorker
        : createPersistentTranscriptionWorkerClient({
          session: getWorkerSession(),
          maxWorkerResponseMs,
        });

      if (typeof transcribe !== "function") {
        throw new Error("Browser transcription requires transformers.js in a Web Worker or a configured transcription fallback.");
      }

      const workerRequest = await prepareTranscriptionWorkerRequest({
        request,
        modelId: model.modelId,
        environment,
        remoteModels: model.remoteModels,
        purgeAfterUse: model.purgeAfterUse,
        device: model.device,
        dtype: model.dtype,
      });
      const activeWarmupMetadata = warmupMetadata || {};
      let result;
      try {
        result = await transcribe(
          workerRequest,
          (event) => onProgress(mapClientMlProgress(event, "transcribing")),
        );
      } finally {
        if (typeof transformerWorker !== "function") {
          closeWorkerSession();
        }
      }
      const output = {
        strategy: result.strategy || (model.modelId ? "whisper-transformers.js" : "transformers.js"),
        language: result.language || request.sourceLanguage || "unknown",
        segments: (result.segments || []).map((segment, index) => ({
          index: segment.index || index + 1,
          start: segment.start,
          end: segment.end,
          text: segment.text || "",
        })),
      };
      if (model.modelId) {
        output.metadata = {
          modelId: model.modelId,
          ...(model.remoteModels ? { remoteModels: true } : {}),
          ...(model.purgeAfterUse ? { purgeAfterUse: true } : {}),
          ...(model.device ? { devicePreference: model.device } : {}),
          ...(result.metadata || {}),
          warmup: activeWarmupMetadata,
          warmupTimeoutMs,
        };
      }
      return output;
    },
  };
}

function createPersistentTranscriptionWorkerClient({ session, maxWorkerResponseMs }) {
  if (!session) return undefined;
  return (request, onProgress = () => {}) => session.request({
    requestType: "transcribe",
    resultType: "result",
    request,
    onProgress,
    timeoutMs: maxWorkerResponseMs,
    timeoutMessage: `Browser transcription worker timed out after ${maxWorkerResponseMs}ms.`,
    failureMessage: "Browser transcription worker failed.",
  });
}

function resolveModelRequest({ request, modelId, modelResolver, remoteModels, purgeAfterUse, devicePreference }) {
  const resolved = typeof modelResolver === "function" ? modelResolver(request || {}) : {};
  return {
    modelId: resolved?.modelId || modelId,
    remoteModels: resolved?.remote ?? remoteModels,
    purgeAfterUse: resolved?.purgeAfterUse ?? purgeAfterUse,
    device: resolved?.device || resolved?.devicePreference || devicePreference,
    dtype: resolved?.dtype,
  };
}

async function prepareTranscriptionWorkerRequest({
  request = {},
  modelId,
  environment,
  remoteModels = false,
  purgeAfterUse = false,
  device,
  dtype,
}) {
  const audio = await prepareTranscriptionAudio(request.audio, environment);
  return {
    ...request,
    audio,
    ...(modelId ? { modelId } : {}),
    ...(remoteModels ? { remoteModels: true } : {}),
    ...(purgeAfterUse ? { purgeAfterUse: true } : {}),
    ...(device ? { device } : {}),
    ...(dtype ? { dtype } : {}),
  };
}

async function prepareTranscriptionAudio(audio, environment) {
  if (!audio?.audioBlob || audio?.pcm instanceof Float32Array) {
    return audio;
  }
  const AudioContextCtor = environment?.AudioContext || environment?.webkitAudioContext;
  if (typeof AudioContextCtor !== "function" || typeof audio.audioBlob.arrayBuffer !== "function") {
    return audio;
  }
  const audioContext = new AudioContextCtor({ sampleRate: audio.sampleRateHz || audio.sampleRate || 16000 });
  try {
    const decoded = await audioContext.decodeAudioData(await audio.audioBlob.arrayBuffer());
    const pcm = new Float32Array(decoded.getChannelData(0));
    return {
      ...audio,
      pcm,
      sampleRate: decoded.sampleRate,
      sampleRateHz: decoded.sampleRate,
      channelCount: decoded.numberOfChannels,
      durationSeconds: audio.durationSeconds ?? decoded.duration,
    };
  } finally {
    if (typeof audioContext.close === "function") {
      await audioContext.close();
    }
  }
}
