import { env, ModelRegistry, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.min.js";

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
} = {}) {
  configureModelSource(remoteModels);
  self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 5, message: "Loading local translation model..." } });
  let translator;
  try {
    translator = await getTranslator(modelId);
    self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 70, message: "Running translation warmup sample..." } });
    await translator(sampleText || DEFAULT_SAMPLE_TEXT, createTranslationOptions({ sourceLanguage, targetLanguage }));
  } catch (error) {
    if (purgeOnError) await releaseTranslator(modelId, true);
    throw error;
  }
  self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 100, message: "Translation model warmup complete." } });
  return {
    modelId,
    warmed: true,
    sampleText: sampleText || DEFAULT_SAMPLE_TEXT,
    localModelPath: env.localModelPath,
  };
}

async function translateSegments(request = {}) {
  const modelId = request.modelId || DEFAULT_MODEL_ID;
  configureModelSource(request.remoteModels);
  const translator = await getTranslator(modelId);
  const sourceLanguage = normalizeLanguageCode(request.sourceLanguage || "fr");
  const targetLanguage = normalizeLanguageCode(request.targetLanguage || "en");
  const options = createTranslationOptions({ sourceLanguage, targetLanguage });
  const segments = Array.isArray(request.segments) ? request.segments : [];
  const translatedSegments = [];

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
        message: `Translating segment ${offset + 1}/${segments.length}...`,
      },
    });
    const output = await translator(text, options);
    translatedSegments.push({
      index: segment?.index ?? offset + 1,
      text: extractTranslatedText(output),
    });
  }

  self.postMessage({ type: "progress", event: { stage: "translating", progress: 100, message: "Translation batch complete." } });
  const result = {
    strategy: "opus-mt-transformers.js",
    languagePair: { source: sourceLanguage, target: targetLanguage },
    segments: translatedSegments,
  };
  if (request.purgeAfterUse) {
    result.metadata = await releaseTranslator(modelId, true);
  }
  return result;
}

async function getTranslator(modelId) {
  if (!translatorPromise || translatorModelId !== modelId) {
    translatorModelId = modelId;
    translatorPromise = pipeline("translation", modelId, {
      dtype: "q4",
      progress_callback: (progress) => {
        self.postMessage({ type: "progress", event: { stage: "loading-model", ...progress } });
      },
    });
  }
  return translatorPromise;
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
    translator = await pending;
  } catch {
    // A partial download may still have populated the Transformers.js cache.
  }
  if (translator && typeof translator.dispose === "function") {
    await translator.dispose();
  }
  translatorPromise = undefined;
  translatorModelId = undefined;
  if (purgeCache && typeof ModelRegistry?.clear_pipeline_cache === "function") {
    let report;
    try {
      report = await ModelRegistry.clear_pipeline_cache("translation", modelId, { dtype: "q4" });
    } catch (error) {
      return { cachePurged: false, filesDeleted: 0, purgeError: error?.message || String(error) };
    }
    return { cachePurged: true, filesDeleted: report?.filesDeleted || 0 };
  }
  return { cachePurged: false, filesDeleted: 0 };
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
