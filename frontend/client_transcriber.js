import { mapClientMlProgress } from "./client_ml_progress.js";

export function detectClientTranscriptionCapabilities(environment = globalThis) {
  const transformersJs = typeof environment?.Worker === "function"
    && Boolean(environment?.transformers?.pipeline || environment?.transformersJs);
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
  maxDurationSeconds,
  maxAudioBytes,
  maxSegments,
  maxWorkerResponseMs,
} = {}) {
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

      const transcribe = typeof transformerWorker === "function"
        ? transformerWorker
        : createTranscriptionWorkerClient({ environment, workerUrl, maxWorkerResponseMs });

      if (typeof transcribe !== "function") {
        throw new Error("Browser transcription requires transformers.js in a Web Worker or a configured transcription fallback.");
      }

      const result = await transcribe(
        request,
        (event) => onProgress(mapClientMlProgress(event, "transcribing")),
      );
      return {
        strategy: "transformers.js",
        language: result.language || request.sourceLanguage || "unknown",
        segments: (result.segments || []).map((segment, index) => ({
          index: segment.index || index + 1,
          start: segment.start,
          end: segment.end,
          text: segment.text || "",
        })),
      };
    },
  };
}

function createTranscriptionWorkerClient({ environment, workerUrl, maxWorkerResponseMs }) {
  if (!workerUrl || typeof environment?.Worker !== "function") {
    return undefined;
  }

  return (request, onProgress) => new Promise((resolve, reject) => {
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
        settle(reject, new Error(`Browser transcription worker timed out after ${maxWorkerResponseMs}ms.`));
      }, maxWorkerResponseMs);
    }

    worker.onerror = (event) => {
      settle(reject, new Error(event?.message || "Browser transcription worker failed."));
    };
    worker.onmessage = (event) => {
      const message = event?.data || {};
      if (message.type === "progress") {
        onProgress(message.event);
        return;
      }
      if (message.type === "error") {
        settle(reject, new Error(message.error || "Browser transcription worker failed."));
        return;
      }
      if (message.type === "result") {
        settle(resolve, message.result || {});
      }
    };

    worker.postMessage({ type: "transcribe", request });
  });
}
