import { mapClientMlProgress } from "./client_ml_progress.js";
import { createWorkerRequestSession } from "./worker_request_session.js";

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
  let activeWorkerSession;
  const cancel = () => {
    if (!activeWorkerSession) return;
    const error = new Error("Browser translation cancelled.");
    error.cancelled = true;
    activeWorkerSession.close(error);
  };

  return {
    capabilities: detectClientTranslationCapabilities(environment),
    cancel,

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
        : null;
      const workerSession = typeof localTranslatorWorker !== "function"
        ? createWorkerRequestSession({
            environment,
            workerUrl,
            defaultFailureMessage: "Browser translation worker failed.",
            closedMessage: "Browser translation worker session is closed.",
            busyMessage: "Browser translation worker is already processing a request.",
          })
        : null;
      activeWorkerSession = workerSession;
      const sessionTranslate = createTranslationWorkerClient({ workerSession, maxWorkerResponseMs });
      const browserTranslate = localTranslate || sessionTranslate;
      const translate = typeof browserTranslate === "function"
        ? browserTranslate
        : cloudTranslator;
      const strategy = typeof browserTranslate === "function"
        ? model.remoteModels ? "remote-transformers.js" : "local-transformers.js"
        : "cloud-provider";

      if (typeof translate !== "function") {
        throw new Error("Browser translation requires transformers.js or a configured cloud translation provider.");
      }

      try {
        const warmupMetadata = workerSession
          ? await warmupLocalTranslatorWorker({
              workerSession,
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
      } finally {
        workerSession?.close();
        if (activeWorkerSession === workerSession) activeWorkerSession = undefined;
      }
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

function createTranslationWorkerClient({ workerSession, maxWorkerResponseMs }) {
  if (!workerSession) return undefined;
  return (request, onProgress = () => {}) => workerSession.request({
    requestType: "translate",
    resultType: "result",
    request,
    onProgress,
    timeoutMs: maxWorkerResponseMs,
    timeoutMessage: `Browser translation worker did not respond within ${maxWorkerResponseMs}ms.`,
    failureMessage: "Browser translation worker failed.",
  });
}

function warmupLocalTranslatorWorker({
  workerSession,
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
  if (!workerSession) return null;
  return workerSession.request({
    requestType: "warmup",
    resultType: "warmup-complete",
    request: {
      ...(modelId ? { modelId } : {}),
      ...(warmupSampleText ? { sampleText: warmupSampleText } : {}),
      sourceLanguage,
      targetLanguage,
      ...(remoteModels ? { remoteModels: true } : {}),
      ...(purgeOnError ? { purgeOnError: true } : {}),
      ...(device ? { device } : {}),
    },
    onProgress,
    timeoutMs: warmupTimeoutMs,
    timeoutMessage: `Browser translation warmup worker did not respond within ${warmupTimeoutMs}ms.`,
    failureMessage: "Browser translation warmup failed.",
  });
}
