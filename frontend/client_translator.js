import { mapClientMlProgress } from "./client_ml_progress.js";

export function detectClientTranslationCapabilities(environment = globalThis) {
  const dynamicModels = Boolean(environment?.__xololinguaDynamicModels);
  const localTransformersJs = typeof environment?.Worker === "function";
  const cloudProvider = Boolean(environment?.translationCloudProvider)
    || typeof environment?.createCloudTranslator === "function";

  return {
    localTransformersJs,
    cloudProvider,
    ...(dynamicModels && localTransformersJs ? { remoteModels: true, transientModelCache: true } : {}),
    strategy: localTransformersJs
      ? dynamicModels ? "remote-transformers.js" : "local-transformers.js"
      : cloudProvider
        ? "cloud-provider"
        : "unavailable",
  };
}

export function createClientTranslator({
  environment = globalThis,
  localTranslatorWorker,
  workerUrl,
  modelId,
  modelResolver,
  remoteModels = false,
  purgeAfterUse = false,
  devicePreference,
  warmupTimeoutMs,
  warmupSampleText,
  cloudTranslator,
  maxSegments,
  maxBatchSize,
  maxWorkerResponseMs,
} = {}) {
  return {
    capabilities: detectClientTranslationCapabilities(environment),

    async translateSegments(request, onProgress = () => {}) {
      const model = resolveModelRequest({ request, modelId, modelResolver, remoteModels, purgeAfterUse, devicePreference });

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
        : createTranslationWorkerClient({ environment, workerUrl, maxWorkerResponseMs });
      const translate = typeof localTranslate === "function"
        ? localTranslate
        : cloudTranslator;
      const strategy = typeof localTranslate === "function"
        ? model.remoteModels ? "remote-transformers.js" : "local-transformers.js"
        : "cloud-provider";

      if (typeof translate !== "function") {
        throw new Error("Browser translation requires transformers.js or a configured cloud translation provider.");
      }

      const warmupMetadata = typeof localTranslate === "function" && localTranslatorWorker !== localTranslate
        ? await warmupLocalTranslatorWorker({
            environment,
            workerUrl,
            modelId: model.modelId,
            warmupTimeoutMs,
            warmupSampleText,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            remoteModels: model.remoteModels,
            purgeOnError: model.purgeAfterUse,
            device: model.device,
          }, (event) => onProgress(mapClientMlProgress(event, "translation-warmup")))
        : null;

      const batches = createSegmentBatches(
        request.segments,
        model.purgeAfterUse ? undefined : maxBatchSize,
      );
      const translatedSegments = [];
      let workerMetadata = null;
      for (const [batchIndex, batch] of batches.entries()) {
        const translateRequest = createTranslatorWorkerRequest({
          request,
          modelId: model.modelId,
          segments: batch,
          remoteModels: model.remoteModels,
          purgeAfterUse: model.purgeAfterUse && batchIndex === batches.length - 1,
          device: model.device,
        });
        const result = await translate(
          translateRequest,
          (event) => onProgress(mapBatchProgress(
            mapClientMlProgress(event, "translating"),
            batchIndex,
            batches.length,
          )),
        );
        translatedSegments.push(...(result.segments || []));
        if (result.metadata) {
          workerMetadata = { ...(workerMetadata || {}), ...result.metadata };
        }
      }
      const translatedByIndex = new Map(
        translatedSegments.map((segment) => [segment.index, segment]),
      );

      return {
        strategy,
        ...((model.remoteModels || model.purgeAfterUse || warmupMetadata) ? { metadata: {
          ...(model.remoteModels || model.purgeAfterUse ? { modelId: model.modelId } : {}),
          ...(model.remoteModels ? { remoteModels: true } : {}),
          ...(model.purgeAfterUse ? { purgeAfterUse: true } : {}),
          ...(model.device ? { devicePreference: model.device } : {}),
          ...(warmupMetadata ? { warmup: warmupMetadata } : {}),
          ...(workerMetadata || {}),
        } } : {}),
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

function resolveModelRequest({ request, modelId, modelResolver, remoteModels, purgeAfterUse, devicePreference }) {
  const resolved = typeof modelResolver === "function" ? modelResolver(request || {}) : {};
  return {
    modelId: resolved?.modelId || modelId,
    remoteModels: resolved?.remote ?? remoteModels,
    purgeAfterUse: resolved?.purgeAfterUse ?? purgeAfterUse,
    device: resolved?.device || resolved?.devicePreference || devicePreference,
  };
}

function createTranslatorWorkerRequest({
  request = {},
  modelId,
  segments = [],
  remoteModels = false,
  purgeAfterUse = false,
  device,
}) {
  return {
    ...(modelId ? { modelId } : {}),
    segments,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    ...(remoteModels ? { remoteModels: true } : {}),
    ...(purgeAfterUse ? { purgeAfterUse: true } : {}),
    ...(device ? { device } : {}),
  };
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

function createTranslationWorkerClient({ environment, workerUrl, maxWorkerResponseMs }) {
  return createWorkerRequestClient({
    environment,
    workerUrl,
    requestType: "translate",
    resultType: "result",
    timeoutMs: maxWorkerResponseMs,
    timeoutMessage: `Browser translation worker did not respond within ${maxWorkerResponseMs}ms.`,
  });
}

function warmupLocalTranslatorWorker({
  environment,
  workerUrl,
  modelId,
  warmupTimeoutMs,
  warmupSampleText,
  sourceLanguage,
  targetLanguage,
  remoteModels,
  purgeOnError,
  device,
}, onProgress) {
  if (!Number.isFinite(warmupTimeoutMs) || warmupTimeoutMs <= 0) {
    return null;
  }
  const warmup = createWorkerRequestClient({
    environment,
    workerUrl,
    requestType: "warmup",
    resultType: "warmup-complete",
    timeoutMs: warmupTimeoutMs,
    timeoutMessage: `Browser translation warmup worker did not respond within ${warmupTimeoutMs}ms.`,
  });
  if (typeof warmup !== "function") {
    return null;
  }
  return warmup({
    ...(modelId ? { modelId } : {}),
    ...(warmupSampleText ? { sampleText: warmupSampleText } : {}),
    sourceLanguage,
    targetLanguage,
    ...(remoteModels ? { remoteModels: true } : {}),
    ...(purgeOnError ? { purgeOnError: true } : {}),
    ...(device ? { device } : {}),
  }, onProgress);
}

function createWorkerRequestClient({
  environment,
  workerUrl,
  requestType,
  resultType,
  timeoutMs,
  timeoutMessage,
}) {
  if (!workerUrl || typeof environment?.Worker !== "function") {
    return undefined;
  }

  return (request, onProgress = () => {}) => new Promise((resolve, reject) => {
    const worker = new environment.Worker(workerUrl, { type: "module" });
    let timer = 0;
    let settled = false;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (typeof worker.terminate === "function") {
        worker.terminate();
      }
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result || {});
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        fail(new Error(timeoutMessage));
      }, timeoutMs);
    }

    worker.onerror = (event) => {
      fail(new Error(event?.message || "Browser translation worker failed."));
    };
    worker.onmessage = (event) => {
      const message = event?.data || {};
      if (message.type === "progress") {
        onProgress(message.event);
        return;
      }
      if (message.type === "error") {
        fail(new Error(message.error || "Browser translation worker failed."));
        return;
      }
      if (message.type === resultType) {
        finish(message.result || message.metadata || {});
      }
    };

    worker.postMessage({ type: requestType, request });
  });
}
