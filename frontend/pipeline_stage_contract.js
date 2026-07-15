const PIPELINE_STAGES = new Set([
  "audioExtraction",
  "vad",
  "transcription",
  "translation",
  "srtFormatting",
]);

const PIPELINE_RUNTIMES = new Set([
  "browser",
  "python-fallback",
  "server-fallback",
]);

export function normalizeAudioExtractionStageResult({ runtime, strategy, payload = {}, metadata = {} } = {}) {
  const { audioPayload, audioMetadata } = normalizeAudioExtractionPayload(payload, runtime);
  return createPipelineStageResult({
    stage: "audioExtraction",
    runtime,
    strategy,
    payload: audioPayload,
    metadata: {
      ...audioMetadata,
      ...metadata,
    },
  });
}

export function normalizeVadStageResult({ runtime, strategy, payload = {}, metadata = {} } = {}) {
  return createPipelineStageResult({
    stage: "vad",
    runtime,
    strategy,
    payload: normalizeSegmentsPayload(payload, "VAD"),
    metadata,
  });
}

export function normalizeTranscriptionStageResult({ runtime, strategy, payload = {}, metadata = {} } = {}) {
  return createPipelineStageResult({
    stage: "transcription",
    runtime,
    strategy,
    payload: normalizeSegmentsPayload(payload, "Transcription"),
    metadata,
  });
}

export function normalizeTranslationStageResult({ runtime, strategy, payload = {}, metadata = {} } = {}) {
  return createPipelineStageResult({
    stage: "translation",
    runtime,
    strategy,
    payload: normalizeSegmentsPayload(payload, "Translation"),
    metadata,
  });
}

export function createPipelineStageResult({ stage, runtime, strategy, payload = {}, metadata = {} } = {}) {
  if (!PIPELINE_STAGES.has(stage)) {
    throw new Error(`Pipeline stage result requires a valid stage; received ${String(stage)}.`);
  }
  if (!PIPELINE_RUNTIMES.has(runtime)) {
    throw new Error(`Pipeline stage result requires a valid runtime; received ${String(runtime)}.`);
  }
  if (typeof strategy !== "string" || strategy.length === 0) {
    throw new Error("Pipeline stage result requires a non-empty string strategy.");
  }
  if (!isPlainObject(payload)) {
    throw new Error("Pipeline stage result payload must be an object.");
  }
  if (!isPlainObject(metadata)) {
    throw new Error("Pipeline stage result metadata must be an object.");
  }

  return {
    stage,
    runtime,
    strategy,
    payload,
    metadata,
  };
}

function normalizeAudioExtractionPayload(payload, runtime) {
  const {
    audioId: rawAudioId,
    audioBlob: rawAudioBlob,
    storage: rawStorage,
    mimeType: rawMimeType,
    sampleRateHz: rawSampleRateHz,
    sampleRate,
    durationSeconds: rawDurationSeconds,
    ...audioMetadata
  } = payload;
  const audioBlob = rawAudioBlob ?? null;
  const audioId = rawAudioId ?? null;
  const audioPayload = {
    audioId,
    audioBlob,
    storage: rawStorage ?? inferAudioStorage({ audioId, audioBlob, runtime }),
    mimeType: rawMimeType ?? audioBlob?.type ?? null,
    sampleRateHz: rawSampleRateHz ?? sampleRate ?? null,
    durationSeconds: rawDurationSeconds ?? null,
  };
  if (!audioPayload.audioId && !audioPayload.audioBlob) {
    throw new Error("Audio extraction stage result requires audioId or audioBlob for downstream handoff.");
  }

  return { audioPayload, audioMetadata };
}

function normalizeSegmentsPayload(payload, stageLabel) {
  if (Array.isArray(payload)) {
    return { segments: payload };
  }
  if (isPlainObject(payload) && Array.isArray(payload.segments)) {
    return { segments: payload.segments };
  }
  throw new Error(`${stageLabel} stage result requires a segments array payload.`);
}

function inferAudioStorage({ audioId, audioBlob, runtime }) {
  if (audioBlob) return "browser";
  if (audioId || runtime === "server-fallback" || runtime === "python-fallback") return "server";
  return "none";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
