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
        const segments = await vadWebSegmenter(audio, onProgress);
        return segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
        }));
      }

      throw new Error("Browser voice activity detection requires @ricky0123/vad-web or a configured fallback.");
    },
  };
}
