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
  maxBatchSize,
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

      const batches = createSegmentBatches(request.segments, maxBatchSize);
      const translatedSegments = [];
      for (const [batchIndex, batch] of batches.entries()) {
        const result = await translate(
          { ...request, segments: batch },
          (event) => onProgress(mapBatchProgress(
            mapClientMlProgress(event, "translating"),
            batchIndex,
            batches.length,
          )),
        );
        translatedSegments.push(...(result.segments || []));
      }
      const translatedByIndex = new Map(
        translatedSegments.map((segment) => [segment.index, segment]),
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

function createSegmentBatches(segments = [], maxBatchSize) {
  if (!Number.isFinite(maxBatchSize) || maxBatchSize < 1) {
    return [segments];
  }

  const batches = [];
  for (let index = 0; index < segments.length; index += maxBatchSize) {
    batches.push(segments.slice(index, index + maxBatchSize));
  }
  return batches.length > 0 ? batches : [[]];
}

function mapBatchProgress(event, batchIndex, batchCount) {
  if (batchCount <= 1) {
    return event;
  }
  const batchWidth = 100 / batchCount;
  return {
    ...event,
    progress: Math.round((batchIndex * batchWidth) + ((event.progress / 100) * batchWidth)),
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
