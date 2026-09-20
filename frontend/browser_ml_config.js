import {
  BROWSER_MAX_AUDIO_BYTES,
  BROWSER_MAX_MEDIA_DURATION_SECONDS,
  BROWSER_MAX_SEGMENTS,
} from "./browser_resource_limits.js";

export const BROWSER_ML_CONFIG = Object.freeze({
  modelDownloadTimeoutMs: 900_000,
  devicePreference: "auto",
  vad: Object.freeze({
    maxAudioSeconds: BROWSER_MAX_MEDIA_DURATION_SECONDS,
    maxAudioBytes: BROWSER_MAX_AUDIO_BYTES,
  }),
  transcription: Object.freeze({
    defaultModelId: "Xenova/whisper-base",
    warmupSampleSeconds: 1,
    maxAudioSeconds: BROWSER_MAX_MEDIA_DURATION_SECONDS,
    maxAudioBytes: BROWSER_MAX_AUDIO_BYTES,
    maxSegments: BROWSER_MAX_SEGMENTS,
    inferenceTimeoutMs: 300_000,
  }),
  translation: Object.freeze({
    defaultModelId: "Xenova/opus-mt-fr-en",
    warmupSampleText: "Bonjour le monde.",
    maxMediaSeconds: BROWSER_MAX_MEDIA_DURATION_SECONDS,
    maxSegments: BROWSER_MAX_SEGMENTS,
    maxCharactersPerBatch: 4_000,
    inferenceTimeoutMs: 120_000,
  }),
});
