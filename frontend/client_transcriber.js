import { mapClientMlProgress } from "./client_ml_progress.js";

export function detectClientTranscriptionCapabilities(environment = globalThis) {
  const transformersJs = typeof environment?.Worker === "function";
  const webGpu = Boolean(environment?.navigator?.gpu);

  return {
    transformersJs,
    webGpu,
    strategy: transformersJs ? "transformers.js" : "unavailable",
  };
}

export function createClientTranscriber({
  environment = globalThis,
  transformerWorker,
  workerUrl,
  modelId,
  warmupTimeoutMs,
  warmupSampleSeconds = 1,
  maxDurationSeconds,
  maxAudioBytes,
  maxSegments,
  maxWorkerResponseMs,
} = {}) {
  let warmupPromise;
  let warmupMetadata;

  const ensureWarmup = async (request, onProgress) => {
    if (!modelId || !workerUrl || typeof environment?.Worker !== "function") {
      return undefined;
    }
    if (!warmupPromise) {
      const warmupWorker = createWorkerRequestClient({
        environment,
        workerUrl,
        requestType: "warmup",
        resultType: "warmup-complete",
        maxWorkerResponseMs: warmupTimeoutMs,
        timeoutMessage: `Browser transcription warmup timed out after ${warmupTimeoutMs}ms.`,
        failureMessage: "Browser transcription warmup failed.",
      });
      warmupPromise = warmupWorker({
        modelId,
        sampleSeconds: warmupSampleSeconds,
        sourceLanguage: request?.sourceLanguage || "auto",
      }, onProgress).then((metadata) => {
        warmupMetadata = metadata || {};
        return warmupMetadata;
      }).catch((error) => {
        warmupPromise = undefined;
        throw error;
      });
    }
    return warmupPromise;
  };

  return {
    capabilities: detectClientTranscriptionCapabilities(environment),

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

      await ensureWarmup(request, (event) => onProgress(mapClientMlProgress(event, "asr-warmup")));

      const transcribe = typeof transformerWorker === "function"
        ? transformerWorker
        : createTranscriptionWorkerClient({ environment, workerUrl, maxWorkerResponseMs });

      if (typeof transcribe !== "function") {
        throw new Error("Browser transcription requires transformers.js in a Web Worker or a configured transcription fallback.");
      }

      const workerRequest = await prepareTranscriptionWorkerRequest({ request, modelId, environment });
      const result = await transcribe(
        workerRequest,
        (event) => onProgress(mapClientMlProgress(event, "transcribing")),
      );
      const output = {
        strategy: result.strategy || (modelId ? "whisper-transformers.js" : "transformers.js"),
        language: result.language || request.sourceLanguage || "unknown",
        segments: (result.segments || []).map((segment, index) => ({
          index: segment.index || index + 1,
          start: segment.start,
          end: segment.end,
          text: segment.text || "",
        })),
      };
      if (modelId) {
        output.metadata = {
          modelId,
          warmup: warmupMetadata || {},
          warmupTimeoutMs,
        };
      }
      return output;
    },
  };
}

function createTranscriptionWorkerClient({ environment, workerUrl, maxWorkerResponseMs }) {
  return createWorkerRequestClient({
    environment,
    workerUrl,
    requestType: "transcribe",
    resultType: "result",
    maxWorkerResponseMs,
    timeoutMessage: `Browser transcription worker timed out after ${maxWorkerResponseMs}ms.`,
    failureMessage: "Browser transcription worker failed.",
  });
}

async function prepareTranscriptionWorkerRequest({ request = {}, modelId, environment }) {
  const audio = await prepareTranscriptionAudio(request.audio, environment);
  return modelId ? { ...request, audio, modelId } : { ...request, audio };
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

function createWorkerRequestClient({
  environment,
  workerUrl,
  requestType,
  resultType,
  maxWorkerResponseMs,
  timeoutMessage,
  failureMessage,
}) {
  if (!workerUrl || typeof environment?.Worker !== "function") {
    return undefined;
  }

  return (request, onProgress = () => {}) => new Promise((resolve, reject) => {
    const worker = new environment.Worker(workerUrl, { type: "module" });
    let settled = false;
    let timeoutId;
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (typeof worker.terminate === "function") {
        worker.terminate();
      }
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };

    if (Number.isFinite(maxWorkerResponseMs) && maxWorkerResponseMs > 0) {
      timeoutId = setTimeout(() => {
        settle(reject, new Error(timeoutMessage));
      }, maxWorkerResponseMs);
    }

    worker.onerror = (event) => {
      settle(reject, new Error(event?.message || failureMessage));
    };
    worker.onmessage = (event) => {
      const message = event?.data || {};
      if (message.type === "progress") {
        onProgress(message.event);
        return;
      }
      if (message.type === "error") {
        settle(reject, new Error(message.error || failureMessage));
        return;
      }
      if (message.type === resultType) {
        settle(resolve, message.result || message.metadata || {});
      }
    };

    worker.postMessage({ type: requestType, request });
  });
}
