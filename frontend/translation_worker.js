import { env, ModelRegistry, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.min.js";
import { createRuntimeMetadata, loadPipelineWithDeviceFallback } from "./browser_inference_device.js";

const DEFAULT_MODEL_ID = "Xenova/opus-mt-fr-en";
const DEFAULT_SAMPLE_TEXT = "Bonjour le monde.";

// Production requests select a remote model per language pair. Local models
// remain available for deterministic and offline validation runs.
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;
env.localModelPath = "../models/";
env.backends.onnx.wasm.wasmPaths = "/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/";
const transformersFetch = env.fetch;
env.fetch = (input, init = {}) => transformersFetch(input, withTransientRemoteCache(input, init));

let translatorPromise;
let translatorModelId;
let translatorDevicePreference;
let translatorRuntime;

self.onmessage = async (event) => {
  const message = event?.data || {};
  try {
    if (message.type === "warmup") {
      const metadata = await warmupTranslator(message.request || {});
      self.postMessage({ type: "warmup-complete", metadata });
      return;
    }

    if (message.type === "translate") {
      const result = await translateSegments(message.request || {});
      self.postMessage({ type: "result", result });
      return;
    }

    throw new Error(`Unsupported translation worker message type: ${message.type || "unknown"}.`);
  } catch (error) {
    if (message.request?.purgeAfterUse || message.request?.purgeOnError) {
      await releaseTranslator(message.request.modelId || DEFAULT_MODEL_ID, true);
    }
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function warmupTranslator({
  modelId = DEFAULT_MODEL_ID,
  sampleText = DEFAULT_SAMPLE_TEXT,
  sourceLanguage = "fr",
  targetLanguage = "en",
  remoteModels = false,
  purgeOnError = false,
  device = "auto",
} = {}) {
  const warmupStartedAt = nowMs();
  configureModelSource(remoteModels);
  self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 5, message: "Loading translation model..." } });
  let translator;
  let modelLoadMs = 0;
  let warmupInferenceMs = 0;
  try {
    const modelLoadStartedAt = nowMs();
    const stopModelHeartbeat = startModelPreparationHeartbeat("OPUS");
    try {
      translator = await getTranslator(modelId, device);
    } finally {
      stopModelHeartbeat();
    }
    modelLoadMs = elapsedMs(modelLoadStartedAt);
    self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 70, message: "Running translation warmup sample..." } });
    const inferenceStartedAt = nowMs();
    await translator(sampleText || DEFAULT_SAMPLE_TEXT, createTranslationOptions({ sourceLanguage, targetLanguage }));
    warmupInferenceMs = elapsedMs(inferenceStartedAt);
  } catch (error) {
    if (purgeOnError) await releaseTranslator(modelId, true);
    throw error;
  }
  const warmupTotalMs = elapsedMs(warmupStartedAt);
  self.postMessage({
    type: "progress",
    event: {
      stage: "translation-warmup",
      progress: 100,
      message: `Translation warmup complete in ${formatSeconds(warmupTotalMs)} (model ${formatSeconds(modelLoadMs)}, inference ${formatSeconds(warmupInferenceMs)}).`,
      timings: { modelLoadMs, warmupInferenceMs, warmupTotalMs },
    },
  });
  return {
    modelId,
    warmed: true,
    sampleText: sampleText || DEFAULT_SAMPLE_TEXT,
    localModelPath: env.localModelPath,
    timings: { modelLoadMs, warmupInferenceMs, warmupTotalMs },
    ...createRuntimeMetadata(translatorRuntime),
  };
}

async function translateSegments(request = {}) {
  const requestStartedAt = nowMs();
  const modelId = request.modelId || DEFAULT_MODEL_ID;
  configureModelSource(request.remoteModels);
  const translator = await getTranslator(modelId, request.device || "auto");
  const sourceLanguage = normalizeLanguageCode(request.sourceLanguage || "fr");
  const targetLanguage = normalizeLanguageCode(request.targetLanguage || "en");
  const options = createTranslationOptions({ sourceLanguage, targetLanguage });
  const segments = Array.isArray(request.segments) ? request.segments : [];
  const translatedSegments = [];
  const segmentTimings = [];
  let totalInferenceMs = 0;
  let characterCount = 0;

  for (const [offset, segment] of segments.entries()) {
    const text = String(segment?.text || "").trim();
    if (!text) {
      translatedSegments.push({ index: segment?.index ?? offset + 1, text: "" });
      continue;
    }
    self.postMessage({
      type: "progress",
      event: {
        stage: "translating",
        progress: Math.round((offset / Math.max(1, segments.length)) * 100),
        translationProgress: Math.round((offset / Math.max(1, segments.length)) * 100),
        message: `Translating segment ${offset + 1}/${segments.length}...`,
      },
    });
    const inferenceStartedAt = nowMs();
    const output = await translator(text, options);
    const inferenceMs = elapsedMs(inferenceStartedAt);
    totalInferenceMs += inferenceMs;
    characterCount += text.length;
    segmentTimings.push({
      index: segment?.index ?? offset + 1,
      characterCount: text.length,
      inferenceMs,
    });
    translatedSegments.push({
      index: segment?.index ?? offset + 1,
      text: extractTranslatedText(output),
    });
    self.postMessage({
      type: "progress",
      event: {
        stage: "translating",
        progress: Math.round(((offset + 1) / Math.max(1, segments.length)) * 100),
        translationProgress: Math.round(((offset + 1) / Math.max(1, segments.length)) * 100),
        message: `Translated segment ${offset + 1}/${segments.length} in ${formatSeconds(inferenceMs)}.`,
        segmentInferenceMs: inferenceMs,
        totalInferenceMs: roundMetric(totalInferenceMs),
      },
    });
  }

  self.postMessage({ type: "progress", event: { stage: "translating", progress: 100, translationProgress: 100, message: `Translation batch complete in ${formatSeconds(totalInferenceMs)}.` } });
  const result = {
    strategy: "opus-mt-transformers.js",
    languagePair: { source: sourceLanguage, target: targetLanguage },
    segments: translatedSegments,
    metadata: {
      ...createRuntimeMetadata(translatorRuntime),
      timings: {
        segmentCount: segments.length,
        characterCount,
        inferenceMs: roundMetric(totalInferenceMs),
        translationWallMs: elapsedMs(requestStartedAt),
        segments: segmentTimings,
      },
    },
  };
  if (request.purgeAfterUse) {
    const cleanupStartedAt = nowMs();
    const releaseMetadata = await releaseTranslator(modelId, true);
    result.metadata = {
      ...result.metadata,
      ...releaseMetadata,
      timings: {
        ...result.metadata.timings,
        cleanupMs: elapsedMs(cleanupStartedAt),
        requestTotalMs: elapsedMs(requestStartedAt),
      },
    };
  } else {
    result.metadata.timings.requestTotalMs = elapsedMs(requestStartedAt);
  }
  return result;
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt) {
  return roundMetric(Math.max(0, nowMs() - startedAt));
}

function roundMetric(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function startModelPreparationHeartbeat(label) {
  const startedAt = nowMs();
  const timer = setInterval(() => {
    self.postMessage({
      type: "progress",
      event: {
        stage: "loading-model",
        progress: 5,
        message: `${label} download or compilation is still active — ${formatSeconds(elapsedMs(startedAt))} elapsed.`,
      },
    });
  }, 5_000);
  return () => clearInterval(timer);
}

async function getTranslator(modelId, devicePreference = "auto") {
  if (!translatorPromise || translatorModelId !== modelId || translatorDevicePreference !== devicePreference) {
    translatorModelId = modelId;
    translatorDevicePreference = devicePreference;
    translatorPromise = loadPipelineWithDeviceFallback({
      createPipeline: pipeline,
      task: "translation",
      modelId,
      dtype: "q4",
      devicePreference,
      environment: self,
      pipelineOptions: {
        progress_callback: (progress) => {
          self.postMessage({ type: "progress", event: { stage: "loading-model", ...progress } });
        },
      },
      onLifecycle: (event) => self.postMessage({ type: "progress", event }),
    });
  }
  const loaded = await translatorPromise;
  translatorRuntime = loaded.runtime;
  return loaded.pipeline;
}

function configureModelSource(remoteModels) {
  env.allowRemoteModels = Boolean(remoteModels);
  env.allowLocalModels = !remoteModels;
  env.useBrowserCache = true;
}

function withTransientRemoteCache(input, init) {
  const url = typeof input === "string" ? input : input?.url || String(input);
  return url.startsWith(env.remoteHost) ? { ...init, cache: "no-store" } : init;
}

async function releaseTranslator(modelId, purgeCache) {
  const pending = translatorPromise;
  let translator = null;
  try {
    translator = (await pending)?.pipeline;
  } catch {
    // A partial download may still have populated the Transformers.js cache.
  }
  if (translator && typeof translator.dispose === "function") {
    await translator.dispose();
  }
  translatorPromise = undefined;
  translatorModelId = undefined;
  translatorDevicePreference = undefined;
  const runtimeMetadata = createRuntimeMetadata(translatorRuntime);
  translatorRuntime = undefined;
  if (purgeCache && typeof ModelRegistry?.clear_pipeline_cache === "function") {
    let report;
    try {
      report = await ModelRegistry.clear_pipeline_cache("translation", modelId, { dtype: "q4" });
    } catch (error) {
      return { ...runtimeMetadata, cachePurged: false, filesDeleted: 0, purgeError: error?.message || String(error) };
    }
    return { ...runtimeMetadata, cachePurged: true, filesDeleted: report?.filesDeleted || 0 };
  }
  return { ...runtimeMetadata, cachePurged: false, filesDeleted: 0 };
}

function createTranslationOptions({ sourceLanguage, targetLanguage } = {}) {
  const srcLang = toNllbLanguageCode(sourceLanguage, "fra_Latn");
  const tgtLang = toNllbLanguageCode(targetLanguage, "eng_Latn");
  return {
    src_lang: srcLang,
    tgt_lang: tgtLang,
  };
}

function extractTranslatedText(output) {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    const first = output[0] || {};
    return String(first.translation_text || first.generated_text || first.text || "").trim();
  }
  return String(output?.translation_text || output?.generated_text || output?.text || "").trim();
}

function normalizeLanguageCode(language) {
  if (typeof language === "string") return language;
  if (typeof language?.code === "string") return language.code;
  return String(language || "");
}

function toNllbLanguageCode(language, fallback) {
  const code = normalizeLanguageCode(language).toLowerCase();
  const mapping = {
    en: "eng_Latn",
    fr: "fra_Latn",
  };
  return mapping[code] || language || fallback;
}
