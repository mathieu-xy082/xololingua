import { createHybridPipelineRouter } from "./client_pipeline_router.js";

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
    capabilityReport: createAppCapabilityReport(capabilityReport, clientAdapters),
    clientAdapters,
    serverAdapters: {
      audioExtraction: (file, onProgress) => backendClient.extractAudio(file, onProgress),
      vad: (audioId, onProgress) => backendClient.segmentAudio(audioId, onProgress),
    },
    srtFormatter,
  });
}

function createAppCapabilityReport(capabilityReport = {}, clientAdapters = {}) {
  return {
    ...capabilityReport,
    stages: Object.fromEntries(
      Object.entries(capabilityReport.stages || {}).map(([stageName, stage]) => [
        stageName,
        stage.runtime === "browser" && typeof clientAdapters[stageName] !== "function"
          ? { ...stage, runtime: "server-fallback" }
          : stage,
      ]),
    ),
  };
}
