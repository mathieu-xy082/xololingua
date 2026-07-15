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
      if (typeof vadWebSegmenter === "function") {
        onProgress(0);
        const result = await vadWebSegmenter(audio, onProgress);
        const segments = normalizeVadSegments(result);
        return {
          stage: "vad",
          runtime: "browser",
          strategy: "vad-web",
          payload: {
            segments,
          },
          metadata: normalizeVadMetadata(result),
        };
      }

      throw new Error("Browser voice activity detection requires @ricky0123/vad-web or a configured fallback.");
    },
  };
}

function normalizeVadSegments(result) {
  const segments = Array.isArray(result) ? result : result?.segments;
  if (!Array.isArray(segments)) {
    throw new Error("Browser VAD segmenter must return a segments array.");
  }

  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
  }));
}

function normalizeVadMetadata(result) {
  if (Array.isArray(result) || result?.diagnostics === undefined) {
    return {};
  }
  return {
    diagnostics: result.diagnostics,
  };
}
