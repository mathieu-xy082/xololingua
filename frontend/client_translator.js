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
      if (model.browserAvailable === false) {
        throw new Error(model.unavailableReason || `No browser translation model is available for ${request.sourceLanguage} → ${request.targetLanguage}.`);
      }

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
        const route = Array.isArray(model.route) && model.route.length > 0
          ? model.route
          : [{ sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, modelId: model.modelId }];
        const warmups = [];
        const translationHops = [];
        let currentSegments = request.segments;
        let workerMetadata = null;
        for (const [routeIndex, routeStep] of route.entries()) {
          if (route.length > 1) {
            const routeProgress = Math.round((routeIndex / route.length) * 100);
            onProgress({
              stage: "translation-route",
              progress: routeProgress,
              translationProgress: routeProgress,
              routeIndex: routeIndex + 1,
              routeCount: route.length,
              modelId: routeStep.modelId,
              sourceLanguage: routeStep.sourceLanguage,
              targetLanguage: routeStep.targetLanguage,
              message: `Translation hop ${routeIndex + 1}/${route.length}: preparing ${routeStep.modelId} (${routeStep.sourceLanguage} → ${routeStep.targetLanguage})...`,
            });
          }
          const warmupMetadata = workerSession
            ? await warmupLocalTranslatorWorker({
                workerSession,
                modelId: routeStep.modelId,
                warmupTimeoutMs,
                warmupSampleText,
                sourceLanguage: routeStep.sourceLanguage,
                targetLanguage: routeStep.targetLanguage,
                remoteModels: model.remoteModels,
                purgeOnError: model.purgeAfterUse,
                device: model.device,
              }, (event) => onProgress(mapRouteProgress(
                mapClientMlProgress(event, "translation-warmup"), routeIndex, route.length,
              )))
            : null;
          if (warmupMetadata) warmups.push(warmupMetadata);

          const batches = createSegmentBatches(
            currentSegments,
            model.purgeAfterUse ? undefined : maxBatchSize,
          );
          const translatedSegments = [];
          let routeStepMetadata = null;
          for (const [batchIndex, batch] of batches.entries()) {
            const translateRequest = createTranslatorWorkerRequest({
              request: {
                ...request,
                sourceLanguage: routeStep.sourceLanguage,
                targetLanguage: routeStep.targetLanguage,
              },
              modelId: routeStep.modelId,
              segments: batch,
              remoteModels: model.remoteModels,
              purgeAfterUse: model.purgeAfterUse,
              device: model.device,
            });
            const result = await translate(
              translateRequest,
              (event) => onProgress(mapRouteProgress(
                mapBatchProgress(
                  mapClientMlProgress(event, "translating"),
                  batchIndex,
                  batches.length,
                ), routeIndex, route.length,
              )),
            );
            translatedSegments.push(...(result.segments || []));
            if (result.metadata) {
              workerMetadata = { ...(workerMetadata || {}), ...result.metadata };
              routeStepMetadata = { ...(routeStepMetadata || {}), ...result.metadata };
            }
          }
          translationHops.push({
            sourceLanguage: routeStep.sourceLanguage,
            targetLanguage: routeStep.targetLanguage,
            modelId: routeStep.modelId,
            ...(warmupMetadata ? { warmup: warmupMetadata } : {}),
            ...(routeStepMetadata || {}),
          });
          const translatedByIndex = new Map(translatedSegments.map((segment) => [segment.index, segment]));
          currentSegments = currentSegments.map((segment) => ({
            ...segment,
            text: translatedByIndex.get(segment.index)?.text || "",
          }));
        }

        return {
          strategy,
          ...((model.remoteModels || model.purgeAfterUse || warmups.length > 0 || model.route) ? { metadata: {
            ...(model.remoteModels || model.purgeAfterUse ? { modelId: model.modelId } : {}),
            ...(model.remoteModels ? { remoteModels: true } : {}),
            ...(model.purgeAfterUse ? { purgeAfterUse: true } : {}),
            ...(model.device ? { devicePreference: model.device } : {}),
            ...(warmups.length > 0 ? { warmup: warmups[0] } : {}),
            ...(model.route && warmups.length > 0 ? { warmups } : {}),
            ...(workerMetadata || {}),
            ...(route.length > 1 ? aggregateTranslationHopMetadata(translationHops, segmentCount) : {}),
            ...(model.route ? {
              translationRoute: route.map((step) => ({
                sourceLanguage: step.sourceLanguage,
                targetLanguage: step.targetLanguage,
                modelId: step.modelId,
              })),
              ...(model.pivotLanguage ? { pivotLanguage: model.pivotLanguage } : {}),
            } : {}),
          } } : {}),
          segments: currentSegments.map((segment) => ({
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: segment.text || "",
          })),
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
    ...(Array.isArray(resolved?.route) ? { route: resolved.route } : {}),
    ...(resolved?.pivotLanguage ? { pivotLanguage: resolved.pivotLanguage } : {}),
    ...(resolved?.browserAvailable === false ? {
      browserAvailable: false,
      unavailableReason: resolved.unavailableReason,
    } : {}),
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

function mapRouteProgress(event, routeIndex, routeCount) {
  if (routeCount <= 1) return event;
  const routeWidth = 100 / routeCount;
  return {
    ...event,
    progress: Math.round((routeIndex * routeWidth) + ((event.progress / 100) * routeWidth)),
    message: event.message
      ? `[translation hop ${routeIndex + 1}/${routeCount}] ${event.message}`
      : event.message,
  };
}

function aggregateTranslationHopMetadata(hops, segmentCount) {
  const metadataHops = hops.filter((hop) => hop && typeof hop === "object");
  const runtimeHops = metadataHops.filter((hop) => hop.executionDevice || hop.timings || hop.cachePurged !== undefined);
  const aggregate = { translationHops: metadataHops };
  if (runtimeHops.length === 0) return aggregate;
  const runtimeLabels = [...new Set(runtimeHops.map((hop) => hop.executionDeviceLabel).filter(Boolean))];
  const runtimeDevices = [...new Set(runtimeHops.map((hop) => hop.executionDevice).filter(Boolean))];
  const fallbackReasons = [...new Set(runtimeHops.map((hop) => hop.deviceFallbackReason).filter(Boolean))];
  const inferenceMs = runtimeHops.reduce((total, hop) => total + Number(hop.timings?.inferenceMs || 0), 0);
  const warmupTotalMs = runtimeHops.reduce((total, hop) => total + Number(hop.warmup?.timings?.warmupTotalMs || 0), 0);
  const filesDeleted = runtimeHops.reduce((total, hop) => total + Number(hop.filesDeleted || 0), 0);
  return {
    ...aggregate,
    ...(runtimeDevices.length > 0 ? { executionDevice: runtimeDevices.join("/") } : {}),
    ...(runtimeLabels.length > 0 ? { executionDeviceLabel: runtimeLabels.join(" / ") } : {}),
    ...(fallbackReasons.length > 0 ? { deviceFallbackReason: fallbackReasons.join(" | ") } : {}),
    cachePurged: runtimeHops.every((hop) => hop.cachePurged === true),
    filesDeleted,
    timings: {
      inferenceMs,
      segmentCount,
      hopCount: runtimeHops.length,
    },
    warmup: { timings: { warmupTotalMs } },
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
