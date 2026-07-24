import {
  BROWSER_MODEL_ASSET_MANIFEST,
  buildModelAssetBootstrapPlan,
  buildModelAssetCacheUrls,
  createBrowserModelAssetReport,
} from "./model_asset_manifest.js";

export function buildBrowserModelAssetCacheName(manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  return `xololingua-model-assets-${manifest?.version || "unversioned"}`;
}

export async function inspectBrowserModelAssetCache({
  environment = globalThis,
  manifest = BROWSER_MODEL_ASSET_MANIFEST,
  cacheName = buildBrowserModelAssetCacheName(manifest),
} = {}) {
  const expectedUrls = buildModelAssetCacheUrls(manifest);
  const issues = [];

  if (!environment?.caches || typeof environment.caches.open !== "function") {
    return {
      available: false,
      cacheName,
      cachedUrls: [],
      missingUrls: expectedUrls,
      issues: ["Cache API is unavailable; browser model assets cannot be verified offline."],
    };
  }

  try {
    const cache = await environment.caches.open(cacheName);
    const cachedUrls = [];
    const missingUrls = [];
    for (const url of expectedUrls) {
      const response = await cache.match(url);
      if (response) {
        cachedUrls.push(url);
      } else {
        missingUrls.push(url);
      }
    }

    return {
      available: true,
      cacheName,
      cachedUrls,
      missingUrls,
      issues,
    };
  } catch (error) {
    return {
      available: false,
      cacheName,
      cachedUrls: [],
      missingUrls: expectedUrls,
      issues: [`Cache API inspection failed: ${error?.message || String(error)}`],
    };
  }
}

export async function resolveBrowserModelAssetBootstrap({
  environment = globalThis,
  manifest = BROWSER_MODEL_ASSET_MANIFEST,
} = {}) {
  const storage = detectBrowserModelStorage(environment);
  const cache = await inspectBrowserModelAssetCache({ environment, manifest });
  const report = createBrowserModelAssetReport({
    manifest,
    cachedUrls: cache.cachedUrls,
  });
  const plan = buildModelAssetBootstrapPlan({
    manifest,
    cachedUrls: cache.cachedUrls,
  });
  const unavailableIssues = [
    ...cache.issues,
    ...storage.issues,
  ];
  const status = unavailableIssues.length > 0
    ? "unavailable"
    : plan.status;
  const missingModelAssets = collectMissingModelAssets({ manifest, cachedUrls: cache.cachedUrls });
  const fallbackRequiredStages = status === "offline-ready"
    ? []
    : report.fallbackRequiredStages;
  const fallbackReason = status === "offline-ready"
    ? null
    : unavailableIssues.length > 0
      ? unavailableIssues.join(" ")
      : plan.fallback.fallbackReason;

  return {
    version: manifest.version,
    status,
    storage: {
      cacheApi: storage.cacheApi,
      indexedDb: storage.indexedDb,
    },
    cache,
    offlineReadyStages: status === "unavailable" ? [] : report.offlineReadyStages,
    bootstrapRequiredStages: status === "offline-ready" ? [] : report.bootstrapRequiredStages,
    fallbackRequiredStages,
    totalRequiredBytes: report.totalRequiredBytes,
    totalMissingBytes: report.totalMissingBytes,
    cacheUrls: report.cacheUrls,
    stageRows: report.stageRows,
    missingModelAssets,
    bootstrapPlan: plan,
    fallback: {
      runtime: status === "offline-ready" ? null : "server-fallback",
      fallbackRequiredStages,
      fallbackReason,
      attemptedBrowserStrategy: fallbackRequiredStages.length === 0
        ? null
        : attemptedBrowserStrategies(manifest, fallbackRequiredStages).join(", "),
      missingModelAssets,
    },
  };
}

function detectBrowserModelStorage(environment) {
  const cacheApi = Boolean(environment?.caches && typeof environment.caches.open === "function");
  const indexedDb = Boolean(environment?.indexedDB);
  const issues = [];
  if (!cacheApi) {
    issues.push("Cache API is unavailable; browser model assets cannot be verified offline.");
  }
  if (!indexedDb) {
    issues.push("IndexedDB is unavailable; browser model runtime metadata cannot be persisted.");
  }
  return { cacheApi, indexedDb, issues };
}

function collectMissingModelAssets({ manifest, cachedUrls }) {
  const cached = new Set(cachedUrls);
  return modelEntries(manifest).flatMap(([stage, model]) => requiredAssets(model, manifest)
    .filter((asset) => !cached.has(asset.versionedUrl))
    .map((asset) => ({
      stage,
      assetName: asset.name || asset.url,
      url: asset.url,
      versionedUrl: asset.versionedUrl,
      bytes: asset.bytes,
      sha256: asset.sha256,
      retryable: true,
    })));
}

function attemptedBrowserStrategies(manifest, stages) {
  return stages
    .map((stage) => manifest?.models?.[stage]?.strategy)
    .filter(Boolean);
}

function modelEntries(manifest) {
  return Object.entries(manifest?.models || {})
    .sort(([leftStage], [rightStage]) => stageOrder(leftStage) - stageOrder(rightStage));
}

function stageOrder(stage) {
  return stage === "transcription" ? 0 : stage === "translation" ? 1 : 99;
}

function requiredAssets(model, manifest) {
  return (model.assets || [])
    .filter((asset) => asset.required !== false)
    .map((asset) => ({
      ...asset,
      versionedUrl: `${asset.url}?v=${encodeURIComponent(manifest?.version || "unversioned")}`,
      bytes: Number.isFinite(asset.bytes) ? asset.bytes : 0,
    }));
}
