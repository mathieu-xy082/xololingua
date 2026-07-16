import { normalizeVadStageResult } from "./pipeline_stage_contract.js";

export function detectClientVadCapabilities(environment = globalThis) {
  const vadWeb = Boolean(environment?.vad?.MicVAD)
    || Boolean(environment?.vadWeb)
    || typeof environment?.createVadSegmenter === "function";

  return {
    vadWeb,
    strategy: vadWeb ? "vad-web" : "unavailable",
  };
}

export function createClientVadSegmenter({
  environment = globalThis,
  vadWebSegmenter,
} = {}) {
  return {
    capabilities: detectClientVadCapabilities(environment),

    async segmentAudio(audio, onProgress = () => {}) {
      const segmenter = typeof vadWebSegmenter === "function"
        ? vadWebSegmenter
        : environment?.createVadSegmenter;
      if (typeof segmenter === "function") {
        onProgress(0);
        const result = await segmenter(audio, onProgress);
        return normalizeVadStageResult({
          runtime: "browser",
          strategy: "vad-web",
          payload: normalizeVadPayload(result),
          metadata: normalizeVadMetadata(result),
        });
      }

      throw new Error("Browser voice activity detection requires @ricky0123/vad-web or a configured fallback.");
    },
  };
}

function normalizeVadPayload(result) {
  const segments = Array.isArray(result) ? result : result?.segments;
  if (!Array.isArray(segments)) {
    throw new Error("Browser VAD segmenter must return a segments array.");
  }

  return { segments };
}

function normalizeVadMetadata(result) {
  if (Array.isArray(result) || result?.diagnostics === undefined) {
    return {};
  }
  return {
    diagnostics: result.diagnostics,
  };
}
