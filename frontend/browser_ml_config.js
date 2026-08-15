export const BROWSER_ML_CONFIG = Object.freeze({
  modelDownloadTimeoutMs: 900_000,
  transcription: Object.freeze({
    defaultModelId: "Xenova/whisper-base",
    warmupSampleSeconds: 1,
    maxAudioSeconds: 900,
    maxAudioBytes: 250 * 1024 * 1024,
    maxSegments: 300,
    inferenceTimeoutMs: 300_000,
  }),
  translation: Object.freeze({
    defaultModelId: "Xenova/opus-mt-fr-en",
    warmupSampleText: "Bonjour le monde.",
    maxSegments: 300,
    maxCharactersPerBatch: 4_000,
    inferenceTimeoutMs: 120_000,
  }),
});
