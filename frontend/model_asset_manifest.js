const CACHE_URL_VERSION_SEPARATOR = "?v=";

export const BROWSER_MODEL_ASSET_MANIFEST = Object.freeze({
  version: "browser-model-assets-v1",
  timeouts: Object.freeze({
    manifestLoadMs: 15_000,
    assetCacheMs: 900_000,
    runtimeInitMs: 120_000,
    asrWarmupMs: 120_000,
    translationWarmupMs: 180_000,
    asrInferencePerSegmentMs: 90_000,
    translationInferencePerBatchMs: 120_000,
    e2eRealModelsMs: 1_800_000,
  }),
  models: Object.freeze({
    transcription: Object.freeze({
      stage: "transcription",
      provider: "transformers.js",
      strategy: "whisper-transformers.js",
      modelId: "Xenova/whisper-tiny",
      license: "MIT model card / OpenAI Whisper lineage; verify before shipping weights",
      sourceLanguages: Object.freeze(["auto", "fr"]),
      runtimeRequirements: Object.freeze({
        worker: true,
        wasm: true,
        webGpu: "optional",
        indexedDb: true,
        cacheApi: true,
      }),
      warmup: Object.freeze({ timeoutMs: 120_000, sampleSeconds: 1 }),
      limits: Object.freeze({ maxAudioSeconds: 900, maxAudioBytes: 250 * 1024 * 1024 }),
      assets: Object.freeze([
        Object.freeze({
          name: "asr-manifest",
          url: "models/asr/whisper-tiny/manifest.json",
          bytes: 1,
          sha256: "pending-real-asset-checksum",
          required: true,
        }),
      ]),
    }),
    translation: Object.freeze({
      stage: "translation",
      provider: "transformers.js",
      strategy: "nllb-transformers.js",
      modelId: "Xenova/nllb-200-distilled-600M",
      license: "CC-BY-NC-4.0 model card; verify compatibility before shipping weights",
      languagePairs: Object.freeze([{ source: "fr", target: "en" }]),
      runtimeRequirements: Object.freeze({
        worker: true,
        wasm: true,
        webGpu: "optional",
        indexedDb: true,
        cacheApi: true,
      }),
      warmup: Object.freeze({ timeoutMs: 180_000, sampleText: "Bonjour le monde." }),
      limits: Object.freeze({ maxSegments: 300, maxCharactersPerBatch: 4_000 }),
      assets: Object.freeze([
        Object.freeze({
          name: "translation-manifest",
          url: "models/translation/nllb-fr-en/manifest.json",
          bytes: 1,
          sha256: "pending-real-asset-checksum",
          required: true,
        }),
      ]),
    }),
  }),
});

export function buildModelAssetCacheUrls(manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  const version = manifest?.version || "unversioned";
  return modelEntries(manifest)
    .flatMap(([, model]) => Array.isArray(model.assets) ? model.assets : [])
    .filter((asset) => asset?.required !== false)
    .map((asset) => `${asset.url}${CACHE_URL_VERSION_SEPARATOR}${encodeURIComponent(version)}`);
}

export function createBrowserModelAssetReport({
  manifest = BROWSER_MODEL_ASSET_MANIFEST,
  cachedUrls = [],
} = {}) {
  const cached = new Set(cachedUrls);
  const stageRows = modelEntries(manifest).map(([stage, model]) => {
    const requiredAssets = (model.assets || [])
      .filter((asset) => asset.required !== false)
      .map((asset) => ({
        ...asset,
        versionedUrl: versionAssetUrl(asset.url, manifest.version),
        bytes: Number.isFinite(asset.bytes) ? asset.bytes : 0,
      }));
    const requiredUrls = requiredAssets.map((asset) => asset.versionedUrl);
    const missingAssets = requiredAssets.filter((asset) => !cached.has(asset.versionedUrl));
    const missingUrls = missingAssets.map((asset) => asset.versionedUrl);
    const requiredBytes = requiredAssets.reduce((total, asset) => total + asset.bytes, 0);
    const missingBytes = missingAssets.reduce((total, asset) => total + asset.bytes, 0);
    const status = missingUrls.length === 0 ? "offline-ready" : "bootstrap-required";
    const fallbackReason = status === "offline-ready"
      ? null
      : `Model assets are not cached for ${stage}; Python fallback remains required until bootstrap completes.`;

    return {
      stage,
      status,
      strategy: model.strategy,
      provider: model.provider,
      modelId: model.modelId,
      requiredUrls,
      missingUrls,
      requiredBytes,
      missingBytes,
      fallbackReason,
      attemptedBrowserStrategy: model.strategy,
    };
  });

  const totalRequiredBytes = stageRows.reduce((total, row) => total + row.requiredBytes, 0);
  const totalMissingBytes = stageRows.reduce((total, row) => total + row.missingBytes, 0);

  return {
    version: manifest.version,
    offlineReadyStages: stageRows.filter((row) => row.status === "offline-ready").map((row) => row.stage),
    bootstrapRequiredStages: stageRows.filter((row) => row.status === "bootstrap-required").map((row) => row.stage),
    fallbackRequiredStages: stageRows.filter((row) => row.status !== "offline-ready").map((row) => row.stage),
    totalRequiredBytes,
    totalMissingBytes,
    cacheUrls: buildModelAssetCacheUrls(manifest),
    stageRows,
  };
}

export function validateBrowserModelAssetManifest(manifest = BROWSER_MODEL_ASSET_MANIFEST) {
  const issues = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest must be an object."];
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    issues.push("manifest.version is required.");
  }
  if (!manifest.timeouts || typeof manifest.timeouts !== "object") {
    issues.push("manifest.timeouts is required for browser real model stages.");
  }

  for (const requiredStage of ["transcription", "translation"]) {
    if (!manifest.models?.[requiredStage]) {
      issues.push(`models.${requiredStage} is required.`);
    }
  }

  for (const [stage, model] of modelEntries(manifest)) {
    if (model.stage !== stage) {
      issues.push(`models.${stage}.stage must be ${stage}.`);
    }
    if (!model.provider) {
      issues.push(`models.${stage}.provider is required.`);
    }
    if (!model.strategy) {
      issues.push(`models.${stage}.strategy is required.`);
    }
    if (!model.modelId) {
      issues.push(`models.${stage}.modelId is required.`);
    }
    if (!Array.isArray(model.assets) || model.assets.length === 0) {
      issues.push(`models.${stage}.assets must list at least one local asset manifest.`);
      continue;
    }
    model.assets.forEach((asset, index) => {
      if (!asset?.url || typeof asset.url !== "string") {
        issues.push(`models.${stage}.assets[${index}].url is required.`);
      } else if (/^https?:\/\//.test(asset.url) || asset.url.startsWith("//")) {
        issues.push(`models.${stage}.assets[${index}].url must be a relative local asset path, got ${asset.url}.`);
      }
      if (!asset?.sha256) {
        issues.push(`models.${stage}.assets[${index}].sha256 is required for cache integrity.`);
      }
    });
  }

  return issues;
}

function modelEntries(manifest) {
  return Object.entries(manifest?.models || {})
    .sort(([leftStage], [rightStage]) => stageOrder(leftStage) - stageOrder(rightStage));
}

function stageOrder(stage) {
  return stage === "transcription" ? 0 : stage === "translation" ? 1 : 99;
}

function versionAssetUrl(url, version) {
  return `${url}${CACHE_URL_VERSION_SEPARATOR}${encodeURIComponent(version || "unversioned")}`;
}
