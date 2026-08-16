const IDLE_DESCRIPTION = "Models will be downloaded automatically for the selected language pair and purged after subtitle generation.";

export function createModelDeliveryTracker() {
  return { current: null, completed: [] };
}

export function beginModelDelivery(tracker, { stage, modelId } = {}) {
  const completed = stage === "transcription" ? [] : [...(tracker?.completed || [])];
  return {
    completed,
    current: {
      stage,
      modelId,
      phase: "preparing",
      files: {},
      file: "",
      loaded: null,
      total: null,
      progress: 0,
      message: `Preparing ${modelId} for browser ${stage}...`,
    },
  };
}

export function updateModelDelivery(tracker, event = {}) {
  if (!tracker?.current) return tracker || createModelDeliveryTracker();

  if (event.stage === "inference-runtime") {
    return {
      ...tracker,
      current: {
        ...tracker.current,
        executionDevice: event.device || "wasm",
        executionDeviceLabel: event.deviceLabel || "WASM CPU",
        deviceFallbackReason: event.fallbackReason || "",
        progress: Math.max(1, tracker.current.progress),
        message: event.message || `Using ${event.deviceLabel || "WASM CPU"} for browser inference.`,
      },
    };
  }

  if (event.stage === "transcribing" || event.stage === "translating") {
    return {
      ...tracker,
      current: {
        ...tracker.current,
        phase: "inference",
        progress: 100,
        message: event.message
          || `${tracker.current.modelId} is loaded; ${event.stage} is running with ${tracker.current.executionDeviceLabel || "the browser runtime"}...`,
      },
    };
  }

  if (!isModelLifecycleEvent(event)) return tracker;

  const file = typeof event.file === "string"
    ? event.file
    : typeof event.name === "string"
      ? event.name
      : tracker.current.file;
  const files = updateFileProgress(tracker.current.files, file, event);
  const aggregate = aggregateFileProgress(files);
  const runtimeReady = event.status === "ready"
    || ((event.stage === "asr-warmup" || event.stage === "translation-warmup")
      && Number(event.progress) >= 70);
  const activeFile = selectActiveFile(files, file);
  const progress = runtimeReady ? 100 : calculateDeliveryProgress(aggregate, tracker.current.progress);
  const message = event.message
    || (runtimeReady
    ? `${tracker.current.modelId} is loaded; preparing browser inference...`
    : activeFile
      ? `Downloading ${tracker.current.modelId} — ${shortFileName(activeFile)}...`
      : `Preparing ${tracker.current.modelId} download...`);

  return {
    ...tracker,
    current: {
      ...tracker.current,
      phase: runtimeReady ? "ready" : "downloading",
      files,
      file: activeFile || file,
      loaded: aggregate.loaded,
      total: aggregate.total,
      completedFileCount: aggregate.completed,
      fileCount: aggregate.count,
      progress,
      message,
    },
  };
}

export function finishModelDelivery(tracker, { stageResult, modelId } = {}) {
  const metadata = stageResult?.metadata || {};
  const completed = [
    ...(tracker?.completed || []).filter((entry) => entry.stage !== stageResult?.stage),
    {
      stage: stageResult?.stage,
      modelId,
      runtime: stageResult?.runtime,
      cachePurged: metadata.cachePurged === true,
      filesDeleted: Number.isFinite(metadata.filesDeleted) ? metadata.filesDeleted : 0,
      purgeError: metadata.purgeError || "",
      executionDevice: metadata.executionDevice || "unknown",
      executionDeviceLabel: metadata.executionDeviceLabel || metadata.executionDevice || "unknown runtime",
      deviceFallbackReason: metadata.deviceFallbackReason || "",
      timings: metadata.timings || {},
      warmupTimings: metadata.warmup?.timings || {},
    },
  ];
  return { current: null, completed };
}

export function failModelDelivery(tracker, error) {
  if (!tracker?.current) return tracker || createModelDeliveryTracker();
  return {
    ...tracker,
    current: {
      ...tracker.current,
      message: `Model delivery failed: ${error?.message || String(error)}`,
    },
  };
}

export function describeModelDelivery(tracker) {
  if (tracker?.current) {
    const { progress, loaded, total, message, phase, completedFileCount, fileCount } = tracker.current;
    return {
      status: message,
      progress,
      progressText: formatProgress({ progress, loaded, total, phase, completedFileCount, fileCount }),
    };
  }

  const completed = tracker?.completed || [];
  if (completed.length === 0) {
    return { status: IDLE_DESCRIPTION, progress: 0, progressText: "on demand" };
  }

  const fallbacks = completed.filter((entry) => entry.runtime !== "browser");
  if (fallbacks.length > 0) {
    return {
      status: `Browser model delivery was unavailable for ${fallbacks.map((entry) => entry.modelId).join(", ")}; Python fallback was used.`,
      progress: 100,
      progressText: "fallback",
    };
  }

  const unconfirmed = completed.filter((entry) => !entry.cachePurged);
  if (unconfirmed.length > 0) {
    const purgeError = unconfirmed.map((entry) => entry.purgeError).find(Boolean);
    return {
      status: `Models were used, but transient cache purge could not be confirmed${purgeError ? `: ${purgeError}` : "."}`,
      progress: 100,
      progressText: "purge unconfirmed",
    };
  }

  const deletedFiles = completed.reduce((total, entry) => total + entry.filesDeleted, 0);
  const runtimeLabels = [...new Set(completed.map((entry) => entry.executionDeviceLabel).filter(Boolean))];
  const performanceSummary = `${formatTranscriptionPerformance(completed)}${formatTranslationPerformance(completed)}`;
  return {
    status: `Browser models used successfully with ${runtimeLabels.join(" / ")}; transient cache purge confirmed (${deletedFiles} cached files deleted).${performanceSummary}`,
    progress: 100,
    progressText: "purged",
  };
}

function formatTranscriptionPerformance(completed) {
  const transcription = completed.find((entry) => entry.stage === "transcription");
  const timings = transcription?.timings;
  if (!Number.isFinite(timings?.inferenceMs) || !Number.isFinite(timings?.audioSeconds)) return "";
  const warmupMs = Number(transcription?.warmupTimings?.warmupTotalMs || 0);
  const realtimeFactor = Number.isFinite(timings.realtimeFactor)
    ? timings.realtimeFactor
    : timings.audioSeconds > 0
      ? (timings.inferenceMs / 1000) / timings.audioSeconds
      : 0;
  return ` ASR: ${formatSeconds(timings.inferenceMs)} inference for ${timings.audioSeconds.toFixed(1)}s audio (${realtimeFactor.toFixed(2)}× realtime)${warmupMs > 0 ? `; warmup ${formatSeconds(warmupMs)}` : ""}.`;
}

function formatTranslationPerformance(completed) {
  const translation = completed.find((entry) => entry.stage === "translation");
  const timings = translation?.timings;
  if (!Number.isFinite(timings?.inferenceMs) || !Number.isFinite(timings?.segmentCount)) return "";
  const warmupMs = Number(translation?.warmupTimings?.warmupTotalMs || 0);
  return ` Translation: ${formatSeconds(timings.inferenceMs)} inference for ${timings.segmentCount} segments${warmupMs > 0 ? `; warmup ${formatSeconds(warmupMs)}` : ""}.`;
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatProgress({ progress, loaded, total, phase, completedFileCount = 0, fileCount = 0 }) {
  if (phase === "inference" || phase === "ready") {
    const assetLabel = fileCount > 0 ? ` · ${completedFileCount}/${fileCount} assets` : "";
    return `ready${assetLabel}`;
  }
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
    return `${progress}% · ${formatBytes(loaded)} / ${formatBytes(total)} · ${completedFileCount}/${fileCount} assets`;
  }
  return `${progress}%`;
}

function isModelLifecycleEvent(event) {
  return event.stage === "loading-model"
    || event.stage === "asr-warmup"
    || event.stage === "translation-warmup"
    || ["download", "progress", "initiate", "done", "ready"].includes(event.status);
}

function updateFileProgress(existingFiles = {}, file, event) {
  if (!file) return existingFiles;
  const previous = existingFiles[file] || {};
  const total = Number.isFinite(event.total) && event.total > 0 ? event.total : previous.total;
  let loaded = Number.isFinite(event.loaded) ? event.loaded : previous.loaded;
  const done = event.status === "done" || (Number.isFinite(event.progress) && clampProgress(event.progress) >= 100);
  if (done && Number.isFinite(total)) loaded = total;
  return {
    ...existingFiles,
    [file]: {
      loaded: Number.isFinite(loaded) ? loaded : 0,
      total: Number.isFinite(total) ? total : 0,
      done,
    },
  };
}

function aggregateFileProgress(files = {}) {
  const entries = Object.entries(files);
  return entries.reduce((aggregate, [, file]) => {
    aggregate.count += 1;
    if (file.done) aggregate.completed += 1;
    if (file.total > 0) {
      aggregate.total += file.total;
      aggregate.loaded += Math.min(file.loaded, file.total);
    }
    return aggregate;
  }, { loaded: 0, total: 0, completed: 0, count: 0 });
}

function selectActiveFile(files = {}, latestFile = "") {
  const incomplete = Object.entries(files)
    .filter(([, file]) => !file.done)
    .sort(([, left], [, right]) => right.total - left.total);
  if (incomplete.length > 0) return incomplete[0][0];
  return latestFile;
}

function calculateDeliveryProgress(aggregate, previousProgress) {
  if (aggregate.total > 0 && aggregate.completed < aggregate.count) {
    return Math.min(99, Math.round((aggregate.loaded / aggregate.total) * 100));
  }
  if (aggregate.count > 0) {
    return Math.max(5, Math.min(95, previousProgress || 0));
  }
  return Math.max(1, Math.min(95, previousProgress || 0));
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function shortFileName(file) {
  return file.split("/").filter(Boolean).at(-1) || file;
}

function clampProgress(value) {
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export { IDLE_DESCRIPTION };
