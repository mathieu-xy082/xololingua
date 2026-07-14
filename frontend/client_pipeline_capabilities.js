import { detectClientAudioExtractionCapabilities } from "./client_audio_extractor.js";
import { detectVadWebRuntimeCapabilities } from "./vad_web_runtime.js";
import { detectClientTranscriptionCapabilities } from "./client_transcriber.js";
import { detectClientTranslationCapabilities } from "./client_translator.js";

const PIPELINE_STAGE_ORDER = [
  "audioExtraction",
  "vad",
  "transcription",
  "translation",
];

const PIPELINE_STAGE_LABELS = {
  audioExtraction: "Audio extraction",
  vad: "VAD / segmentation",
  transcription: "Transcription",
  translation: "Translation",
};

const PYTHON_FALLBACK_ENDPOINTS = {
  audioExtraction: ["POST /api/extract-audio"],
  vad: ["POST /api/segment-audio"],
  transcription: ["POST /api/transcribe-audio", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
  translation: ["POST /api/translate-segments", "POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
};

export function collectClientPipelineCapabilities(environment = globalThis) {
  return createClientPipelineCapabilityReport({
    audioExtraction: detectClientAudioExtractionCapabilities(environment),
    vad: detectVadWebRuntimeCapabilities(environment),
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

  const mode = serverFallbackStages.length === 0 ? "client-side" : "hybrid-fallback";

  return {
    mode,
    stages,
    browserStages,
    serverFallbackStages,
    demoSummary: createDemoSummary({ mode, stages, browserStages, serverFallbackStages }),
  };
}

function createDemoSummary({ mode, stages, browserStages, serverFallbackStages }) {
  const browserCount = browserStages.length;
  const fallbackCount = serverFallbackStages.length;
  const headline = mode === "client-side"
    ? `Client-side PWA: ${browserCount} browser stages, no Python fallback stages`
    : `Hybrid PWA: ${browserCount} browser stages, ${fallbackCount} Python fallback stages`;

  return {
    headline,
    browserStageLabels: browserStages.map((stageName) => PIPELINE_STAGE_LABELS[stageName]),
    serverFallbackStageLabels: serverFallbackStages.map((stageName) => PIPELINE_STAGE_LABELS[stageName]),
    serverFallbackEndpoints: serverFallbackStages.map((stageName) => ({
      stage: stageName,
      label: PIPELINE_STAGE_LABELS[stageName],
      endpoints: PYTHON_FALLBACK_ENDPOINTS[stageName],
    })),
    stageRows: PIPELINE_STAGE_ORDER.map((stageName) => ({
      stage: stageName,
      label: PIPELINE_STAGE_LABELS[stageName],
      runtimeLabel: stages[stageName].runtime === "browser" ? "Browser" : "Python fallback",
      strategy: stages[stageName].strategy,
      fallbackEndpoints: stages[stageName].runtime === "browser" ? [] : PYTHON_FALLBACK_ENDPOINTS[stageName],
    })),
  };
}
