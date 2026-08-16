export function mapClientMlProgress(event, defaultStage) {
  if (typeof event === "number") {
    return {
      stage: defaultStage,
      progress: normalizeProgressValue(event),
    };
  }

  if (!event || typeof event !== "object") {
    return event;
  }

  const progress = Number.isFinite(event.progress)
    ? event.progress
    : calculateLoadedProgress(event);
  if (!Number.isFinite(progress)) {
    return event;
  }

  const normalizedProgress = normalizeProgressValue(progress);
  const message = event.message || describeMlProgress(event, normalizedProgress);
  return {
    ...event,
    stage: event.stage || defaultStage,
    progress: normalizedProgress,
    ...(message ? { message } : {}),
  };
}

function describeMlProgress(event, progress) {
  if (event.stage !== "loading-model") return undefined;
  const file = typeof event.file === "string"
    ? event.file
    : typeof event.name === "string"
      ? event.name
      : "";
  const shortFile = file.split("/").filter(Boolean).at(-1) || "model assets";
  if (event.status === "done") return `Downloaded ${shortFile}; preparing browser model...`;
  if (file) return `Downloading ${shortFile} — ${progress}%...`;
  return undefined;
}

function calculateLoadedProgress(event) {
  if (!Number.isFinite(event.loaded) || !Number.isFinite(event.total) || event.total <= 0) {
    return undefined;
  }
  return (event.loaded / event.total) * 100;
}

function normalizeProgressValue(value) {
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
