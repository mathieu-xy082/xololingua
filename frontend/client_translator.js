export function detectClientTranslationCapabilities(environment = globalThis) {
  const localTransformersJs = typeof environment?.Worker === "function"
    && Boolean(environment?.transformers?.pipeline || environment?.transformersJs);
  const cloudProvider = Boolean(environment?.translationCloudProvider)
    || typeof environment?.createCloudTranslator === "function";

  return {
    localTransformersJs,
    cloudProvider,
    strategy: localTransformersJs
      ? "local-transformers.js"
      : cloudProvider
        ? "cloud-provider"
        : "unavailable",
  };
}

export function createClientTranslator({
  environment = globalThis,
  localTranslatorWorker,
  cloudTranslator,
} = {}) {
  return {
    capabilities: detectClientTranslationCapabilities(environment),

    async translateSegments(request, onProgress = () => {}) {
      const translate = typeof localTranslatorWorker === "function"
        ? localTranslatorWorker
        : cloudTranslator;
      const strategy = typeof localTranslatorWorker === "function"
        ? "local-transformers.js"
        : "cloud-provider";

      if (typeof translate !== "function") {
        throw new Error("Browser translation requires transformers.js or a configured cloud translation provider.");
      }

      const result = await translate(request, onProgress);
      const translatedByIndex = new Map(
        (result.segments || []).map((segment) => [segment.index, segment]),
      );

      return {
        strategy,
        segments: request.segments.map((segment) => {
          const translated = translatedByIndex.get(segment.index) || {};
          return {
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: translated.text || "",
          };
        }),
      };
    },
  };
}
