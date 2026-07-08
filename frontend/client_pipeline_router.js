const PYTHON_FALLBACK_ENDPOINTS = {
  audioExtraction: "POST /api/extract-audio",
  vad: "POST /api/segment-audio",
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
  };
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
    result.fallbackEndpoint = PYTHON_FALLBACK_ENDPOINTS[stageName];
  }

  return result;
}
