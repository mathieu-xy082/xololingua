const PYTHON_FALLBACK_ENDPOINTS = {
  audioExtraction: ["POST /api/extract-audio"],
  vad: ["POST /api/segment-audio"],
  transcription: ["POST /api/transcribe-audio"],
  translation: ["POST /api/subtitle-jobs", "GET /api/subtitle-jobs/{jobId}"],
};

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

export function createHybridPipelineRouter({
  capabilityReport,
  clientAdapters = {},
  serverAdapters = {},
  srtFormatter,
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
        onStageComplete = () => {},
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
      onStageComplete(createUserStageReportRow("audioExtraction", audioExtraction));
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
      onStageComplete(createUserStageReportRow("vad", vad));

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
      onStageComplete(createUserStageReportRow("transcription", transcription));

      const translation = await runStage({
        stageName: "translation",
        browserAdapterLabel: "Browser translation",
        serverAdapterLabel: "Python fallback translation",
        input: {
          extractedAudio: audioExtraction.payload,
          sourceLanguage,
          targetLanguage,
          segments: transcription.payload,
        },
        onProgress: onTranslationProgress,
        capabilityReport,
        clientAdapters,
        serverAdapters,
      });
      onStageComplete(createUserStageReportRow("translation", translation));

      const stageResults = {
        audioExtraction,
        vad,
        transcription,
        translation,
      };

      const translatedSegments = translation.payload;

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
        userStageReport: createUserStageReport(stageResults),
        serverFallbackStages: summarizeServerFallbackStages(stageResults),
        translatedSegments,
        srtText: typeof srtFormatter === "function" ? srtFormatter(translatedSegments) : undefined,
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

function createUserStageReport(stageResults) {
  return PIPELINE_STAGE_ORDER.map((stage) => createUserStageReportRow(stage, stageResults[stage]));
}

function createUserStageReportRow(stage, result) {
  const row = {
    stage,
    label: PIPELINE_STAGE_LABELS[stage],
    runtime: result.runtime,
    runtimeLabel: result.runtime === "browser" ? "Browser" : "Python fallback",
    strategy: result.strategy,
    status: result.runtime === "browser" ? "completed" : "completed-via-fallback",
    fallbackEndpoints: result.fallbackEndpoints || [],
  };

  if (result.browserFailureReason) {
    row.browserFailureReason = result.browserFailureReason;
  }

  return row;
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

  let payload;
  let browserFailureReason;

  try {
    payload = await adapter(input, onProgress);
  } catch (error) {
    if (!useBrowser || typeof serverAdapters[stageName] !== "function") {
      throw error;
    }
    browserFailureReason = error instanceof Error ? error.message : String(error);
    payload = await serverAdapters[stageName](input, onProgress);
  }

  const result = {
    runtime: browserFailureReason || !useBrowser ? "server-fallback" : "browser",
    strategy: stage.strategy,
    payload,
  };

  if (result.runtime === "server-fallback") {
    result.fallbackEndpoints = stage.fallbackEndpoints || PYTHON_FALLBACK_ENDPOINTS[stageName];
  }
  if (browserFailureReason || stage.browserFailureReason) {
    result.browserFailureReason = browserFailureReason || stage.browserFailureReason;
  }

  return result;
}
