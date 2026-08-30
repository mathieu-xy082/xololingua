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
  const metadata = result.metadata || {};
  const fallbackEndpoints = metadata.fallbackEndpoints || result.fallbackEndpoints || [];
  const browserFailureReason = metadata.browserFailureReason || result.browserFailureReason;
  const fallback = fallbackEndpoints.length
    ? ` via ${fallbackEndpoints.join(", ")}`
    : "";
  const reason = browserFailureReason
    ? ` — fallback reason: ${browserFailureReason}`
    : "";
  const device = result.runtime === "browser" && (metadata.executionDeviceLabel || metadata.executionDevice)
    ? ` on ${metadata.executionDeviceLabel || metadata.executionDevice}`
    : "";
  const route = result.stage === "translation"
    ? formatTranslationRoute(metadata.translationRoute)
    : "";
  const deviceFallback = result.runtime === "browser" && metadata.deviceFallbackReason
    ? ` — WebGPU fallback reason: ${metadata.deviceFallbackReason}`
    : "";
  return `${label}: ${runtime}${strategy}${device}${route}${fallback}${reason}${deviceFallback}`;
}

function formatTranslationRoute(route) {
  if (!Array.isArray(route) || route.length < 2) return "";
  const languages = [route[0]?.sourceLanguage, ...route.map((step) => step?.targetLanguage)].filter(Boolean);
  const modelIds = route.map((step) => step?.modelId).filter(Boolean);
  const models = modelIds.length === route.length ? ` using ${modelIds.join(" then ")}` : "";
  return languages.length > 1 ? ` via ${languages.join(" → ")}${models}` : "";
}
