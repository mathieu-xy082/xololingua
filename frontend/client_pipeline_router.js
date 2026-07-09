const PYTHON_FALLBACK_ENDPOINTS = {
  audioExtraction: ["POST /api/extract-audio"],
  vad: ["POST /api/segment-audio"],
  transcription: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
  translation: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
};

export function createHybridPipelineRouter({
  capabilityReport,
  clientAdapters = {},
  serverAdapters = {},
} = {}) {
  return {
    async runAudioExtraction(file, onProgress = () => {}) {
      return runStage({
        stageName: "audioExtraction",
        browserAdapterLabel: "Browser audio extraction",
        serverAdapterLabel: "Python fallback audio extraction",
        input: file,
        onProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
    },

    async runVadSegmentation(audioId, onProgress = () => {}) {
      return runStage({
        stageName: "vad",
        browserAdapterLabel: "Browser VAD segmentation",
        serverAdapterLabel: "Python fallback VAD segmentation",
        input: audioId,
        onProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
    },

    async runTranscription(transcriptionRequest, onProgress = () => {}) {
      return runStage({
        stageName: "transcription",
        browserAdapterLabel: "Browser transcription",
        serverAdapterLabel: "Python fallback transcription",
        input: transcriptionRequest,
        onProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
    },

    async runTranslation(translationRequest, onProgress = () => {}) {
      return runStage({
        stageName: "translation",
        browserAdapterLabel: "Browser translation",
        serverAdapterLabel: "Python fallback translation",
        input: translationRequest,
        onProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
    },

    async runSubtitlePipeline(
      { file, sourceLanguage, targetLanguage },
      {
        onAudioExtractionProgress = () => {},
        onVadProgress = () => {},
        onTranscriptionProgress = () => {},
        onTranslationProgress = () => {},
      } = {},
    ) {
      const audioExtraction = await runStage({
        stageName: "audioExtraction",
        browserAdapterLabel: "Browser audio extraction",
        serverAdapterLabel: "Python fallback audio extraction",
        input: file,
        onProgress: onAudioExtractionProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
      const audioId = audioExtraction.payload?.audioId || audioExtraction.payload;

      const vad = await runStage({
        stageName: "vad",
        browserAdapterLabel: "Browser VAD segmentation",
        serverAdapterLabel: "Python fallback VAD segmentation",
        input: audioId,
        onProgress: onVadProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });

      const transcription = await runStage({
        stageName: "transcription",
        browserAdapterLabel: "Browser transcription",
        serverAdapterLabel: "Python fallback transcription",
        input: { audioId, sourceLanguage, segments: vad.payload },
        onProgress: onTranscriptionProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });

      const translation = await runStage({
        stageName: "translation",
        browserAdapterLabel: "Browser translation",
        serverAdapterLabel: "Python fallback translation",
        input: {
          sourceLanguage,
          targetLanguage,
          segments: transcription.payload,
        },
        onProgress: onTranslationProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });

      const stageResults = {
        audioExtraction,
        vad,
        transcription,
        translation,
      };

      return {
        audioExtraction,
        vad,
        transcription,
        translation,
        stageRuntimes: {
          audioExtraction: audioExtraction.runtime,
          vad: vad.runtime,
          transcription: transcription.runtime,
          translation: translation.runtime,
        },
        serverFallbackStages: summarizeServerFallbackStages(stageResults),
        translatedSegments: translation.payload,
      };
    },
  };
}

function summarizeServerFallbackStages(stageResults) {
  return Object.entries(stageResults)
    .filter(([, result]) => result.runtime === "server-fallback")
    .map(([stage, result]) => ({
      stage,
      endpoints: result.fallbackEndpoints || PYTHON_FALLBACK_ENDPOINTS[stage],
    }));
}

async function runStage({
  stageName,
  browserAdapterLabel,
  serverAdapterLabel,
  input,
  onProgress,
  capabilityReport,
  clientAdapters,
  serverAdapters,
}) {
  const stage = capabilityReport?.stages?.[stageName] || {
    runtime: "server-fallback",
    strategy: "unavailable",
  };
  const useBrowser = stage.runtime === "browser";
  const adapters = useBrowser ? clientAdapters : serverAdapters;
  const adapter = adapters[stageName];

  if (typeof adapter !== "function") {
    const label = useBrowser ? browserAdapterLabel : serverAdapterLabel;
    throw new Error(`${label} adapter is not configured.`);
  }

  const payload = await adapter(input, onProgress);
  const result = {
    runtime: useBrowser ? "browser" : "server-fallback",
    strategy: stage.strategy,
    payload,
  };

  if (!useBrowser) {
    result.fallbackEndpoints = PYTHON_FALLBACK_ENDPOINTS[stageName];
  }

  return result;
}
