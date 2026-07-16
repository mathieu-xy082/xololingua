import { mapClientMlProgress } from "./client_ml_progress.js";

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
  workerUrl,
  cloudTranslator,
  maxSegments,
} = {}) {
  return {
    capabilities: detectClientTranslationCapabilities(environment),

    async translateSegments(request, onProgress = () => {}) {
      const segmentCount = request?.segments?.length || 0;
      if (
        Number.isFinite(maxSegments)
        && segmentCount > maxSegments
      ) {
        const segmentLabel = maxSegments === 1 ? "segment" : "segments";
        throw new Error(`Browser translation limit exceeded: ${segmentCount} segments is greater than the ${maxSegments} ${segmentLabel} limit.`);
      }

      const localTranslate = typeof localTranslatorWorker === "function"
        ? localTranslatorWorker
        : createTranslationWorkerClient({ environment, workerUrl });
      const translate = typeof localTranslate === "function"
        ? localTranslate
        : cloudTranslator;
      const strategy = typeof localTranslate === "function"
        ? "local-transformers.js"
        : "cloud-provider";

      if (typeof translate !== "function") {
        throw new Error("Browser translation requires transformers.js or a configured cloud translation provider.");
      }

      const result = await translate(
        request,
        (event) => onProgress(mapClientMlProgress(event, "translating")),
      );
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

function createTranslationWorkerClient({ environment, workerUrl }) {
  if (!workerUrl || typeof environment?.Worker !== "function") {
    return undefined;
  }

  return (request, onProgress) => new Promise((resolve, reject) => {
    const worker = new environment.Worker(workerUrl, { type: "module" });
    const cleanup = () => {
      if (typeof worker.terminate === "function") {
        worker.terminate();
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event?.message || "Browser translation worker failed."));
    };
    worker.onmessage = (event) => {
      const message = event?.data || {};
      if (message.type === "progress") {
        onProgress(message.event);
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.error || "Browser translation worker failed."));
        return;
      }
      if (message.type === "result") {
        cleanup();
        resolve(message.result || {});
      }
    };

    worker.postMessage({ type: "translate", request });
  });
}
