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
  const fallbackEndpoints = result.metadata?.fallbackEndpoints || result.fallbackEndpoints || [];
  const browserFailureReason = result.metadata?.browserFailureReason || result.browserFailureReason;
  const fallback = fallbackEndpoints.length
    ? ` via ${fallbackEndpoints.join(", ")}`
    : "";
  const reason = browserFailureReason
    ? ` — fallback reason: ${browserFailureReason}`
    : "";
  return `${label}: ${runtime}${strategy}${fallback}${reason}`;
}
