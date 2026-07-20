import { createHybridPipelineRouter } from "./client_pipeline_router.js";

export function createAppClientAdapters({ clientAudioExtractor, clientVadSegmenter } = {}) {
  const adapters = {};
  if (typeof clientAudioExtractor?.extractAudio === "function") {
    adapters.audioExtraction = (file, onProgress) => clientAudioExtractor.extractAudio(file, onProgress);
  }
  if (typeof clientVadSegmenter?.segmentAudio === "function") {
    adapters.vad = (audio, onProgress) => clientVadSegmenter.segmentAudio(audio, onProgress);
  }
  return adapters;
}

export function createAppHybridPipelineRouter({
  backendClient,
  capabilityReport,
  clientAdapters = {},
  srtFormatter,
} = {}) {
  if (!backendClient) {
    throw new TypeError("createAppHybridPipelineRouter requires a backend client.");
  }

  return createHybridPipelineRouter({
    capabilityReport: createAppCapabilityReport(capabilityReport, clientAdapters, backendClient),
    clientAdapters,
    serverAdapters: {
      audioExtraction: (file, onProgress) => backendClient.extractAudio(file, onProgress),
      vad: async (audio, onProgress) => {
        const audioId = typeof audio === "string" ? audio : audio?.audioId;
        if (audioId) {
          return backendClient.segmentAudio(audioId, onProgress);
        }
        if (typeof backendClient.registerAudio !== "function") {
          throw new Error("Python VAD fallback requires an audio id or browser audio registration endpoint.");
        }
        const registered = await backendClient.registerAudio(audio, (progress) => {
          onProgress(Math.min(35, progress));
        });
        return backendClient.segmentAudio(registered.audioId, onProgress);
      },
      transcription: (request, onProgress) => backendClient.transcribeAudio(request, onProgress),
      translation: async (request, onProgress) => {
        if (typeof backendClient.translateSegments === "function") {
          return backendClient.translateSegments({
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            segments: request.segments,
          }, onProgress);
        }
        const payload = await backendClient.createSubtitleJob({
          extractedAudio: request.extractedAudio,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          segments: request.segments,
        });
        request.onJobCreated?.(payload);
        return backendClient.pollSubtitleJob(payload.jobId, { onProgress });
      },
    },
    srtFormatter,
  });
}

function createAppCapabilityReport(capabilityReport = {}, clientAdapters = {}, backendClient = {}) {
  return {
    ...capabilityReport,
    stages: Object.fromEntries(
      Object.entries(capabilityReport.stages || {}).map(([stageName, stage]) => [
        stageName,
        createAppStageReport(stageName, stage, clientAdapters, backendClient),
      ]),
    ),
  };
}

function createAppStageReport(stageName, stage, clientAdapters, backendClient) {
  const appStage = stage.runtime === "browser" && typeof clientAdapters[stageName] !== "function"
    ? {
        ...stage,
        runtime: "server-fallback",
        browserFailureReason: `Browser ${getAppStageLabel(stageName)} adapter is not configured in app.js; using Python backend fallback.`,
      }
    : stage;

  if (stageName === "translation" && typeof backendClient.translateSegments === "function") {
    return { ...appStage, fallbackEndpoints: ["POST /api/translate-segments"] };
  }

  return appStage;
}

function getAppStageLabel(stageName) {
  return {
    audioExtraction: "audio extraction",
    vad: "VAD / segmentation",
    transcription: "transcription",
    translation: "translation",
  }[stageName] || stageName;
}
