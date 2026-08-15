const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]+)?$/;

export const TRANSIENT_MODEL_POLICY = Object.freeze({
  remote: true,
  purgeAfterUse: true,
  dtype: "q4",
});

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

  return Object.freeze({
    stage: "translation",
    sourceLanguage: source,
    targetLanguage: target,
    modelId: `Xenova/opus-mt-${source}-${target}`,
    task: "translation",
    ...TRANSIENT_MODEL_POLICY,
  });
}
