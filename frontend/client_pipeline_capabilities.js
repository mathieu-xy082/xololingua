import { detectClientAudioExtractionCapabilities } from "./client_audio_extractor.js";
import { detectClientVadCapabilities } from "./client_vad_segmenter.js";
import { detectClientTranscriptionCapabilities } from "./client_transcriber.js";
import { detectClientTranslationCapabilities } from "./client_translator.js";

const PIPELINE_STAGE_ORDER = [
  "audioExtraction",
  "vad",
  "transcription",
  "translation",
];

export function collectClientPipelineCapabilities(environment = globalThis) {
  return createClientPipelineCapabilityReport({
    audioExtraction: detectClientAudioExtractionCapabilities(environment),
    vad: detectClientVadCapabilities(environment),
    transcription: detectClientTranscriptionCapabilities(environment),
    translation: detectClientTranslationCapabilities(environment),
  });
}

export function createClientPipelineCapabilityReport(capabilitiesByStage) {
  const stages = {};
  const browserStages = [];
  const serverFallbackStages = [];

  for (const stageName of PIPELINE_STAGE_ORDER) {
    const capabilities = capabilitiesByStage?.[stageName] || { strategy: "unavailable" };
    const runtime = capabilities.strategy === "unavailable"
      ? "server-fallback"
      : "browser";

    stages[stageName] = {
      ...capabilities,
      runtime,
    };

    if (runtime === "browser") {
      browserStages.push(stageName);
    } else {
      serverFallbackStages.push(stageName);
    }
  }

  return {
    mode: serverFallbackStages.length === 0 ? "client-side" : "hybrid-fallback",
    stages,
    browserStages,
    serverFallbackStages,
  };
}
