const CACHE_URL_VERSION_SEPARATOR = "?v=";

export const BROWSER_MODEL_ASSET_MANIFEST = Object.freeze({
  version: "browser-model-assets-v1",
  timeouts: Object.freeze({
    manifestLoadMs: 15_000,
    assetCacheMs: 900_000,
    runtimeInitMs: 120_000,
    asrWarmupMs: 120_000,
    translationWarmupMs: 180_000,
    asrInferencePerSegmentMs: 300_000,
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
        bytes: 3190,
        sha256: "282c9cc9feb5dc2c822a1edd4a40595c360a5c118bf96360ba4dbfe1075d69fa",
        required: true,
      }),
      Object.freeze({
        name: "added_tokens",
        url: "models/Xenova/whisper-tiny/added_tokens.json",
        bytes: 2082,
        sha256: "ce949fe720c14311cb6c446e69cfe340dc669d7b006077a6feed6ae571dd7e88",
        required: true,
      }),
      Object.freeze({
        name: "config",
        url: "models/Xenova/whisper-tiny/config.json",
        bytes: 2248,
        sha256: "2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94",
        required: true,
      }),
      Object.freeze({
        name: "generation_config",
        url: "models/Xenova/whisper-tiny/generation_config.json",
        bytes: 3716,
        sha256: "68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c",
        required: true,
      }),
      Object.freeze({
        name: "merges",
        url: "models/Xenova/whisper-tiny/merges.txt",
        bytes: 493869,
        sha256: "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
        required: true,
      }),
      Object.freeze({
        name: "normalizer",
        url: "models/Xenova/whisper-tiny/normalizer.json",
        bytes: 52666,
        sha256: "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
        required: true,
      }),
      Object.freeze({
        name: "decoder_model_merged_q4",
        url: "models/Xenova/whisper-tiny/onnx/decoder_model_merged_q4.onnx",
        bytes: 86739474,
        sha256: "462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660",
        required: true,
      }),
      Object.freeze({
        name: "encoder_model_q4",
        url: "models/Xenova/whisper-tiny/onnx/encoder_model_q4.onnx",
        bytes: 9006044,
        sha256: "f895af36f57fec9cbeac8d29a982ae47b2e81e461d98320fbd30c47d01a6a13f",
        required: true,
      }),
      Object.freeze({
        name: "preprocessor_config",
        url: "models/Xenova/whisper-tiny/preprocessor_config.json",
        bytes: 339,
        sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
        required: true,
      }),
      Object.freeze({
        name: "quantize_config",
        url: "models/Xenova/whisper-tiny/quantize_config.json",
        bytes: 2840,
        sha256: "5be0072d627cc8094c2051c38629aed10a509844f562de6d17277756ff0a602c",
        required: true,
      }),
      Object.freeze({
        name: "special_tokens_map",
        url: "models/Xenova/whisper-tiny/special_tokens_map.json",
        bytes: 2194,
        sha256: "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691",
        required: true,
      }),
      Object.freeze({
        name: "tokenizer",
        url: "models/Xenova/whisper-tiny/tokenizer.json",
        bytes: 2480466,
        sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
        required: true,
      }),
      Object.freeze({
        name: "tokenizer_config",
        url: "models/Xenova/whisper-tiny/tokenizer_config.json",
        bytes: 282683,
        sha256: "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce",
        required: true,
      }),
      Object.freeze({
        name: "vocab",
        url: "models/Xenova/whisper-tiny/vocab.json",
        bytes: 1036584,
        sha256: "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
        required: true,
      })
      ]),
    }),
    translation: Object.freeze({
      stage: "translation",
      provider: "transformers.js",
      strategy: "opus-mt-transformers.js",
      modelId: "Xenova/opus-mt-fr-en",
      license: "Helsinki-NLP OPUS-MT model; verify model-card/license compatibility before shipping weights",
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
        url: "models/translation/opus-mt-fr-en/manifest.json",
        bytes: 2712,
        sha256: "84916b510f1173c111f5339ad8cd3171d77c9bd093567d038fb6b5d7fadb0763",
        required: true,
      }),
      Object.freeze({
        name: "config",
        url: "models/Xenova/opus-mt-fr-en/config.json",
        bytes: 1411,
        sha256: "6c2851f154d7b88c7767e4fdcf8a5694a36a456bfa6cbcde1b13fdbade3b56f6",
        required: true,
      }),
      Object.freeze({
        name: "generation_config",
        url: "models/Xenova/opus-mt-fr-en/generation_config.json",
        bytes: 293,
        sha256: "f9a4824ec78c61b4a95afc43bbb6a9545a44ccf1c01d0963a286e799b9e7b256",
        required: true,
      }),
      Object.freeze({
        name: "decoder_model_merged_q4",
        url: "models/Xenova/opus-mt-fr-en/onnx/decoder_model_merged_q4.onnx",
        bytes: 139660803,
        sha256: "8954df5f9b76065b57ae4cfb13d4bf36d5c9f266ee0932a7ada2fde7c06c6d43",
        required: true,
      }),
      Object.freeze({
        name: "encoder_model_q4",
        url: "models/Xenova/opus-mt-fr-en/onnx/encoder_model_q4.onnx",
        bytes: 135007901,
        sha256: "12176e9348d0fa5597f22db468075b2c9fa77e2a3354f50816e11fd1cbc2f331",
        required: true,
      }),
      Object.freeze({
        name: "quantize_config",
        url: "models/Xenova/opus-mt-fr-en/quantize_config.json",
        bytes: 3124,
        sha256: "78dec705fb8e2ca2a491d132be5a91736d98a2a1d1bfcee71476033c6c944216",
        required: true,
      }),
      Object.freeze({
        name: "source",
        url: "models/Xenova/opus-mt-fr-en/source.spm",
        bytes: 802397,
        sha256: "78d0e717c77053f1c4b856d8661d9cb87c64f083a35418c087b9146300e4f585",
        required: true,
      }),
      Object.freeze({
        name: "special_tokens_map",
        url: "models/Xenova/opus-mt-fr-en/special_tokens_map.json",
        bytes: 74,
        sha256: "5e4d1f5e759d74cb1c2fe1d165cfc62b5237aa904de759380cd6f43042eec723",
        required: true,
      }),
      Object.freeze({
        name: "target",
        url: "models/Xenova/opus-mt-fr-en/target.spm",
        bytes: 778395,
        sha256: "173e9f493a668fe396d599e28d414a201193094e6ffd7a4678e5aab0f6d3d838",
        required: true,
      }),
      Object.freeze({
        name: "tokenizer",
        url: "models/Xenova/opus-mt-fr-en/tokenizer.json",
        bytes: 5637839,
        sha256: "8391785c1a2139e7af4678571ccd8dc654ecbb72e4be186940f65d7c604f0246",
        required: true,
      }),
      Object.freeze({
        name: "tokenizer_config",
        url: "models/Xenova/opus-mt-fr-en/tokenizer_config.json",
        bytes: 280,
        sha256: "bba9e6b1e3b9724d15ebacaf11eaac360c5ae3f4139bcdef0ee1610592eaa3fe",
        required: true,
      }),
      Object.freeze({
        name: "vocab",
        url: "models/Xenova/opus-mt-fr-en/vocab.json",
        bytes: 1458196,
        sha256: "f2ba9c69ae20f96b8bd821239a9152be422394f980350b77907cffc183db5f2d",
        required: true,
      })
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
    const requiredAssets = requiredModelAssets(model, manifest);
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

export function buildModelAssetBootstrapPlan({
  manifest = BROWSER_MODEL_ASSET_MANIFEST,
  cachedUrls = [],
} = {}) {
  const cached = new Set(cachedUrls);
  const steps = modelEntries(manifest).flatMap(([stage, model]) => requiredModelAssets(model, manifest)
    .map((asset) => {
      const isCached = cached.has(asset.versionedUrl);
      return {
        stage,
        assetName: asset.name || asset.url,
        url: asset.url,
        versionedUrl: asset.versionedUrl,
        sha256: asset.sha256,
        status: isCached ? "cached" : "pending-download",
        retryable: !isCached,
        progressWeightBytes: asset.bytes,
      };
    }));
  const remainingStages = Array.from(new Set(
    steps.filter((step) => step.status !== "cached").map((step) => step.stage),
  ));
  const totalBytes = steps.reduce((total, step) => total + step.progressWeightBytes, 0);
  const remainingBytes = steps
    .filter((step) => step.status !== "cached")
    .reduce((total, step) => total + step.progressWeightBytes, 0);

  return {
    version: manifest.version,
    status: remainingStages.length === 0 ? "offline-ready" : "bootstrap-required",
    totalAssets: steps.length,
    cachedAssets: steps.filter((step) => step.status === "cached").length,
    remainingAssets: steps.filter((step) => step.status !== "cached").length,
    totalBytes,
    remainingBytes,
    steps,
    fallback: {
      runtime: "server-fallback",
      fallbackRequiredStages: remainingStages,
      fallbackReason: remainingStages.length === 0
        ? null
        : `Browser model bootstrap is incomplete; Python fallback remains required for ${remainingStages.join(", ")}.`,
    },
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
      if (!Number.isFinite(asset?.bytes) || asset.bytes <= 0) {
        issues.push(`models.${stage}.assets[${index}].bytes must be a positive number for bootstrap progress.`);
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

function requiredModelAssets(model, manifest) {
  return (model.assets || [])
    .filter((asset) => asset.required !== false)
    .map((asset) => ({
      ...asset,
      versionedUrl: versionAssetUrl(asset.url, manifest.version),
      bytes: Number.isFinite(asset.bytes) ? asset.bytes : 0,
    }));
}

function versionAssetUrl(url, version) {
  return `${url}${CACHE_URL_VERSION_SEPARATOR}${encodeURIComponent(version || "unversioned")}`;
}
