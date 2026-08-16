export const BROWSER_ML_CONFIG = Object.freeze({
  modelDownloadTimeoutMs: 900_000,
  devicePreference: "auto",
  transcription: Object.freeze({
    defaultModelId: "Xenova/whisper-base",
    mode: "long-form",
    warmupSampleSeconds: 1,
    maxAudioSeconds: 1_800,
    maxAudioBytes: 250 * 1024 * 1024,
    maxSegments: 300,
    inferenceTimeoutMs: 1_800_000,
  }),
  translation: Object.freeze({
    defaultModelId: "Xenova/opus-mt-fr-en",
    warmupSampleText: "Bonjour le monde.",
    maxSegments: 300,
    maxCharactersPerBatch: 4_000,
    inferenceTimeoutMs: 120_000,
  }),
});
