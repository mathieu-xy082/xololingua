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
  const modelBootstrap = formatModelBootstrapMetadata(result.metadata || result);
  const fallback = fallbackEndpoints.length
    ? ` via ${fallbackEndpoints.join(", ")}`
    : "";
  const reason = browserFailureReason
    ? ` — fallback reason: ${browserFailureReason}`
    : "";
  return `${label}: ${runtime}${strategy}${fallback}${reason}${modelBootstrap}`;
}

function formatModelBootstrapMetadata(metadata = {}) {
  const missingAssets = metadata.missingModelAssets || [];
  const status = metadata.modelAssetBootstrapStatus;
  if (!status && missingAssets.length === 0) {
    return "";
  }
  const remaining = formatBytes(metadata.remainingModelAssetBytes || 0);
  const missing = missingAssets.map((asset) => asset.assetName || asset.url).filter(Boolean).join(", ");
  const missingLabel = missing ? `, missing ${missing}` : "";
  return ` — model bootstrap: ${status || "bootstrap-required"}, ${remaining} remaining${missingLabel}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}
