const PIPELINE_STAGE_LABELS = {
  audioExtraction: "Audio extraction",
  vad: "VAD / segmentation",
  transcription: "Transcription",
  translation: "Translation",
};

export function formatPipelineStageSummary(stageResults = []) {
  return stageResults.map(formatPipelineStageRuntime).join("; ");
}

export function formatPipelineStageRuntime(result) {
  const label = PIPELINE_STAGE_LABELS[result.stage] || result.stage || "Pipeline stage";
  const runtime = result.runtime === "browser" ? "Browser" : "Python fallback";
  const strategy = result.strategy ? ` (${result.strategy})` : "";
  const fallback = result.fallbackEndpoints?.length
    ? ` via ${result.fallbackEndpoints.join(", ")}`
    : "";
  const reason = result.browserFailureReason
    ? ` — fallback reason: ${result.browserFailureReason}`
    : "";
  return `${label}: ${runtime}${strategy}${fallback}${reason}`;
}
