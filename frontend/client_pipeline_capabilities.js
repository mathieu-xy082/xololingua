import { detectClientAudioExtractionCapabilities } from "./client_audio_extractor.js";
import { detectVadWebRuntimeCapabilities } from "./vad_web_runtime.js";
import { detectClientTranscriptionCapabilities } from "./client_transcriber.js";
import { detectClientTranslationCapabilities } from "./client_translator.js";
import { resolveBrowserModelAssetBootstrap } from "./model_asset_bootstrap.js";
import { createBrowserModelAssetReport } from "./model_asset_manifest.js";

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
  const modelAssets = createBrowserModelAssetReport({
    cachedUrls: environment?.__xololinguaCachedModelAssetUrls || [],
  });
  return collectClientPipelineCapabilitiesFromModelAssets(environment, modelAssets);
}

export async function collectClientPipelineCapabilitiesWithModelAssetBootstrap(environment = globalThis) {
  const modelAssets = await resolveBrowserModelAssetBootstrap({ environment });
  return collectClientPipelineCapabilitiesFromModelAssets(environment, modelAssets);
}

function collectClientPipelineCapabilitiesFromModelAssets(environment, modelAssets) {
  return createClientPipelineCapabilityReport({
    audioExtraction: detectClientAudioExtractionCapabilities(environment),
    vad: detectVadWebRuntimeCapabilities(environment),
    transcription: applyModelAssetReadiness(
      detectClientTranscriptionCapabilities(environment),
      modelAssets,
      "transcription",
    ),
    translation: applyModelAssetReadiness(
      detectClientTranslationCapabilities(environment),
      modelAssets,
      "translation",
    ),
    modelAssets,
  });
}

export function createClientPipelineCapabilityReport(capabilitiesByStage) {
  const stages = {};
  const browserStages = [];
  const serverFallbackStages = [];

  for (const stageName of PIPELINE_STAGE_ORDER) {
    const capabilities = capabilitiesByStage?.[stageName] || { strategy: "unavailable" };
    const runtime = capabilities.runtime === "server-fallback" || capabilities.strategy === "unavailable"
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
  const hasExplicitModelAssets = Object.prototype.hasOwnProperty.call(capabilitiesByStage || {}, "modelAssets");
  const modelAssets = capabilitiesByStage?.modelAssets || createBrowserModelAssetReport();
  const offlineAvailability = createOfflineAvailability({
    stages,
    browserStages,
    serverFallbackStages,
    modelAssets,
    hasExplicitModelAssets,
  });

  return {
    mode,
    stages,
    browserStages,
    serverFallbackStages,
    offlineAvailability,
    modelAssets,
    demoSummary: createDemoSummary({ mode, stages, browserStages, serverFallbackStages, offlineAvailability }),
  };
}

function applyModelAssetReadiness(capabilities, modelAssets, stageName) {
  if (capabilities?.strategy === "unavailable") {
    return capabilities;
  }
  if (capabilities?.remoteModels) {
    return {
      ...capabilities,
      modelDelivery: "on-demand",
      modelRetention: "purge-after-use",
    };
  }
  const stageAssetRow = modelAssets.stageRows.find((row) => row.stage === stageName);
  if (!stageAssetRow || stageAssetRow.status === "offline-ready") {
    return capabilities;
  }
  return {
    ...capabilities,
    runtime: "server-fallback",
    browserFailureReason: stageAssetRow.fallbackReason,
    attemptedBrowserStrategy: stageAssetRow.attemptedBrowserStrategy,
    modelAssetBootstrapStatus: stageAssetRow.status,
    remainingModelAssetBytes: stageAssetRow.missingBytes || 0,
    missingModelAssets: modelAssets.missingModelAssets?.filter((asset) => asset.stage === stageName) || [],
  };
}

function createOfflineAvailability({ stages, browserStages, serverFallbackStages, modelAssets, hasExplicitModelAssets }) {
  const onlineRequiredStages = browserStages.filter((stageName) => requiresOnlineService(stages[stageName]));
  const offlineCapableStages = browserStages.filter((stageName) => !onlineRequiredStages.includes(stageName));
  const processing = serverFallbackStages.length === 0
    ? onlineRequiredStages.length > 0
      ? "browser-with-online-service"
      : "browser-only"
    : offlineCapableStages.length > 0 || onlineRequiredStages.length > 0
      ? "partial-browser-with-python-fallback"
      : "backend-required";

  return {
    assets: hasExplicitModelAssets
      ? modelAssets?.status || (modelAssets?.totalMissingBytes > 0 ? "bootstrap-required" : "available")
      : "available",
    processing,
    offlineCapableStages,
    backendRequiredStages: [...serverFallbackStages],
    onlineRequiredStages,
  };
}

function createDemoSummary({ mode, stages, browserStages, serverFallbackStages, offlineAvailability }) {
  const browserCount = browserStages.length;
  const fallbackCount = serverFallbackStages.length;
  const headline = mode === "client-side"
    ? `Client-side PWA: ${browserCount} browser stages, no Python fallback stages`
    : `Hybrid PWA: ${browserCount} browser stages, ${fallbackCount} Python fallback stages`;

  const offlineScopeLabel = createOfflineScopeLabel(offlineAvailability);

  return {
    headline,
    offlineScopeLabel,
    browserStageLabels: browserStages.map((stageName) => PIPELINE_STAGE_LABELS[stageName]),
    serverFallbackStageLabels: serverFallbackStages.map((stageName) => PIPELINE_STAGE_LABELS[stageName]),
    serverFallbackEndpoints: serverFallbackStages.map((stageName) => ({
      stage: stageName,
      label: PIPELINE_STAGE_LABELS[stageName],
      endpoints: PYTHON_FALLBACK_ENDPOINTS[stageName],
    })),
    stageRows: PIPELINE_STAGE_ORDER.map((stageName) => createDemoStageRow({
      stageName,
      stageCapabilities: stages[stageName],
      offlineAvailability,
    })),
  };
}

function createDemoStageRow({ stageName, stageCapabilities, offlineAvailability }) {
  const row = {
    stage: stageName,
    label: PIPELINE_STAGE_LABELS[stageName],
    runtimeLabel: stageCapabilities.runtime === "browser" ? "Browser" : "Python fallback",
    strategy: stageCapabilities.strategy,
    fallbackEndpoints: stageCapabilities.runtime === "browser" ? [] : PYTHON_FALLBACK_ENDPOINTS[stageName],
    offlineCapable: offlineAvailability.offlineCapableStages.includes(stageName),
    onlineRequired: offlineAvailability.onlineRequiredStages.includes(stageName),
  };
  const modelAssetBootstrapLabel = formatModelAssetBootstrapLabel(stageCapabilities);
  if (modelAssetBootstrapLabel) {
    row.modelAssetBootstrapStatus = stageCapabilities.modelAssetBootstrapStatus || "bootstrap-required";
    row.remainingModelAssetBytes = stageCapabilities.remainingModelAssetBytes || 0;
    row.missingModelAssets = stageCapabilities.missingModelAssets || [];
    row.modelAssetBootstrapLabel = modelAssetBootstrapLabel;
  }
  return row;
}

function formatModelAssetBootstrapLabel(stageCapabilities = {}) {
  const missingAssets = stageCapabilities.missingModelAssets || [];
  if (!stageCapabilities.modelAssetBootstrapStatus && missingAssets.length === 0) {
    return "";
  }
  const status = stageCapabilities.modelAssetBootstrapStatus || "bootstrap-required";
  const prefix = status === "offline-ready" ? "Model assets ready" : "Model bootstrap required";
  const remaining = formatBytes(stageCapabilities.remainingModelAssetBytes || 0);
  const missingNames = missingAssets.map((asset) => asset.assetName || asset.url).filter(Boolean);
  const firstMissingName = missingNames[0];
  const extraMissingCount = Math.max(0, missingNames.length - 1);
  const missing = extraMissingCount > 0 ? `${firstMissingName} + ${extraMissingCount} more` : firstMissingName;
  const missingLabel = missing ? `; missing ${missing}` : "";
  return `${prefix}: ${remaining} remaining${missingLabel}`;
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

function createOfflineScopeLabel(offlineAvailability) {
  if (offlineAvailability.assets === "unavailable") {
    return "Model asset storage is unavailable; offline ML processing needs Python fallback until browser storage is available.";
  }
  if (offlineAvailability.assets === "bootstrap-required") {
    const offlineLabels = offlineAvailability.offlineCapableStages
      .map((stageName) => PIPELINE_STAGE_LABELS[stageName])
      .join(", ");
    const stageSuffix = offlineLabels
      ? ` before full offline ML processing; ${offlineLabels} can run offline after assets are ready`
      : " before offline ML processing";
    return `Model assets need bootstrap${stageSuffix}.`;
  }
  if (offlineAvailability.backendRequiredStages.length === 0) {
    if (offlineAvailability.onlineRequiredStages.length > 0) {
      const offlineLabels = offlineAvailability.offlineCapableStages
        .map((stageName) => PIPELINE_STAGE_LABELS[stageName])
        .join(", ");
      const onlineLabels = offlineAvailability.onlineRequiredStages
        .map((stageName) => PIPELINE_STAGE_LABELS[stageName])
        .join(", ");
      return `Offline assets available; ${offlineLabels} can run offline, but ${onlineLabels} needs an online browser/cloud provider.`;
    }
    return "Offline assets available; configured processing stages can run in the browser.";
  }

  const fallbackLabels = offlineAvailability.backendRequiredStages
    .map((stageName) => PIPELINE_STAGE_LABELS[stageName])
    .join(", ");

  if (offlineAvailability.offlineCapableStages.length === 0) {
    return `Offline assets available; processing still needs Python fallback for ${fallbackLabels}.`;
  }

  return `Offline assets available; processing is partial and ${fallbackLabels} still need Python fallback.`;
}

function requiresOnlineService(stageCapabilities = {}) {
  return stageCapabilities.strategy === "cloud-provider";
}
