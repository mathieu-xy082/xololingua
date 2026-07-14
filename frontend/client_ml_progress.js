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

  if (!Number.isFinite(event.progress)) {
    return event;
  }

  return {
    ...event,
    stage: event.stage || defaultStage,
    progress: normalizeProgressValue(event.progress),
  };
}

function normalizeProgressValue(value) {
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
