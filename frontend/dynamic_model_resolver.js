const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]+)?$/;

export const TRANSIENT_MODEL_POLICY = Object.freeze({
  remote: true,
  purgeAfterUse: true,
  dtype: "q4",
});

// Keep this list conservative: a direct browser route is only selected when
// its public Xenova ONNX repository is known to exist. Unsupported pairs can
// use the bounded English pivot below when both legs are available.
const DIRECT_TRANSLATION_MODEL_PAIRS = new Set([
  "fr-en", "fr-de", "fr-ru",
  "en-fr", "en-de", "en-es", "en-ru", "en-zh", "en-it", "en-ja", "en-pl", "en-fi", "en-nl", "en-tr", "en-cs",
  "zh-en", "de-en", "es-en", "ru-en", "it-en", "ja-en", "ko-en", "ar-en", "nl-en", "pl-en", "fi-en", "tr-en",
  "it-fr",
]);

export function normalizeLanguageCode(language) {
  const value = typeof language === "string" ? language : language?.code;
  const normalized = String(value || "").trim().toLowerCase().replaceAll("_", "-");
  if (!LANGUAGE_CODE_PATTERN.test(normalized)) {
    throw new Error(`Unsupported language code for a browser model: ${value || "missing"}.`);
  }
  return normalized;
}

export function resolveTranscriptionModel({ sourceLanguage } = {}) {
  return Object.freeze({
    stage: "transcription",
    sourceLanguage: sourceLanguage ? normalizeLanguageCode(sourceLanguage) : "auto",
    modelId: "Xenova/whisper-base",
    task: "automatic-speech-recognition",
    ...TRANSIENT_MODEL_POLICY,
  });
}

export function resolveTranslationModel({ sourceLanguage, targetLanguage } = {}) {
  const source = normalizeLanguageCode(sourceLanguage);
  const target = normalizeLanguageCode(targetLanguage);
  if (source === target) {
    throw new Error(`Browser translation requires different source and target languages (${source}).`);
  }

  const directPair = `${source}-${target}`;
  const direct = createTranslationModel(source, target);
  if (DIRECT_TRANSLATION_MODEL_PAIRS.has(directPair)) return direct;

  const pivot = "en";
  const pivotSourcePair = `${source}-${pivot}`;
  const pivotTargetPair = `${pivot}-${target}`;
  if (source !== pivot && target !== pivot
    && DIRECT_TRANSLATION_MODEL_PAIRS.has(pivotSourcePair)
    && DIRECT_TRANSLATION_MODEL_PAIRS.has(pivotTargetPair)) {
    return Object.freeze({
      stage: "translation",
      sourceLanguage: source,
      targetLanguage: target,
      modelId: `Xenova/opus-mt-${source}-${pivot}`,
      task: "translation",
      route: Object.freeze([
        createTranslationRouteStep(source, pivot),
        createTranslationRouteStep(pivot, target),
      ]),
      pivotLanguage: pivot,
      ...TRANSIENT_MODEL_POLICY,
    });
  }

  return Object.freeze({
    ...direct,
    browserAvailable: false,
    unavailableReason: `No public Xenova ONNX model is registered for ${source} → ${target}.`,
  });
}

function createTranslationModel(source, target) {
  return Object.freeze({
    stage: "translation",
    sourceLanguage: source,
    targetLanguage: target,
    modelId: `Xenova/opus-mt-${source}-${target}`,
    task: "translation",
    ...TRANSIENT_MODEL_POLICY,
  });
}

function createTranslationRouteStep(sourceLanguage, targetLanguage) {
  return Object.freeze({
    sourceLanguage,
    targetLanguage,
    modelId: `Xenova/opus-mt-${sourceLanguage}-${targetLanguage}`,
  });
}
