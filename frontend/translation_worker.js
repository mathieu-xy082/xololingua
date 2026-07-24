import { env, pipeline } from "../node_modules/@huggingface/transformers/dist/transformers.web.min.js";

const DEFAULT_MODEL_ID = "Xenova/nllb-200-distilled-600M";
const DEFAULT_SAMPLE_TEXT = "Bonjour le monde.";

// Browser real-model mode must be explicit/local. The bootstrap workflow is
// responsible for placing compatible Transformers.js assets under this root.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "models/";
env.backends.onnx.wasm.wasmPaths = "../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/";

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
} = {}) {
  self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 5, message: "Loading local translation model..." } });
  const translator = await getTranslator(modelId);
  self.postMessage({ type: "progress", event: { stage: "translation-warmup", progress: 70, message: "Running translation warmup sample..." } });
  await translator(sampleText || DEFAULT_SAMPLE_TEXT, createTranslationOptions({ sourceLanguage, targetLanguage }));
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
  return {
    strategy: "nllb-transformers.js",
    languagePair: { source: sourceLanguage, target: targetLanguage },
    segments: translatedSegments,
  };
}

async function getTranslator(modelId) {
  if (!translatorPromise || translatorModelId !== modelId) {
    translatorModelId = modelId;
    translatorPromise = pipeline("translation", modelId, {
      progress_callback: (progress) => {
        self.postMessage({ type: "progress", event: { stage: "loading-model", ...progress } });
      },
    });
  }
  return translatorPromise;
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
