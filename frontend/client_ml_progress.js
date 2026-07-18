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

  return {
    ...event,
    stage: event.stage || defaultStage,
    progress: normalizeProgressValue(progress),
  };
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
