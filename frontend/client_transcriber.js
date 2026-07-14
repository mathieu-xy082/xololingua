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
  maxDurationSeconds,
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

      if (typeof transformerWorker !== "function") {
        throw new Error("Browser transcription requires transformers.js in a Web Worker or a configured transcription fallback.");
      }

      const result = await transformerWorker(
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
