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

  const progress = Number.isFinite(event.progress)
    ? clampProgress(event.progress)
    : tracker.current.progress;
  const file = typeof event.file === "string"
    ? event.file
    : typeof event.name === "string"
      ? event.name
      : tracker.current.file;
  const loaded = Number.isFinite(event.loaded) ? event.loaded : tracker.current.loaded;
  const total = Number.isFinite(event.total) && event.total > 0 ? event.total : tracker.current.total;
  const isDownload = event.stage === "loading-model"
    || ["download", "progress", "initiate"].includes(event.status);
  const fileLabel = file ? ` — ${shortFileName(file)}` : "";
  const message = isDownload
    ? `Downloading ${tracker.current.modelId}${fileLabel}...`
    : `Loading ${tracker.current.modelId} in the browser...`;

  return {
    ...tracker,
    current: {
      ...tracker.current,
      file,
      loaded,
      total,
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
    const { progress, loaded, total, message } = tracker.current;
    return {
      status: message,
      progress,
      progressText: formatProgress(progress, loaded, total),
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
  return {
    status: `Browser models used successfully; transient cache purge confirmed (${deletedFiles} cached files deleted).`,
    progress: 100,
    progressText: "purged",
  };
}

function formatProgress(progress, loaded, total) {
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
    return `${progress}% · ${formatBytes(loaded)} / ${formatBytes(total)}`;
  }
  return `${progress}%`;
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
