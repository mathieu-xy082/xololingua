import { normalizeVadStageResult } from "./pipeline_stage_contract.js";

const DEFAULT_MAX_SEGMENT_SECONDS = 12;
const DEFAULT_MIN_SEGMENT_SECONDS = 0.4;

export function detectClientVadCapabilities(environment = globalThis) {
  const vadWeb = Boolean(environment?.vad?.MicVAD)
    || Boolean(environment?.vad?.NonRealTimeVAD)
    || Boolean(environment?.vadWeb)
    || typeof environment?.createVadSegmenter === "function";

  return {
    vadWeb,
    strategy: vadWeb ? "vad-web" : "unavailable",
  };
}

export function createClientVadSegmenter({
  environment = globalThis,
  vadWebSegmenter,
} = {}) {
  return {
    capabilities: detectClientVadCapabilities(environment),

    async segmentAudio(audio, onProgress = () => {}) {
      const segmenter = resolveVadSegmenter({ environment, vadWebSegmenter });
      if (typeof segmenter === "function") {
        onProgress(0);
        const result = await segmenter(audio, onProgress);
        return normalizeVadStageResult({
          runtime: "browser",
          strategy: "vad-web",
          payload: normalizeVadPayload(result),
          metadata: normalizeVadMetadata(result),
        });
      }

      throw new Error("Browser voice activity detection requires @ricky0123/vad-web or a configured fallback.");
    },
  };
}

function resolveVadSegmenter({ environment, vadWebSegmenter }) {
  if (typeof vadWebSegmenter === "function") {
    return vadWebSegmenter;
  }
  if (typeof environment?.createVadSegmenter === "function") {
    return environment.createVadSegmenter;
  }
  if (environment?.vad?.NonRealTimeVAD) {
    return createNonRealTimeVadSegmenter(environment.vad.NonRealTimeVAD);
  }
  return undefined;
}

function createNonRealTimeVadSegmenter(nonRealTimeVad) {
  return async (audio, onProgress) => {
    const vad = await nonRealTimeVad.new?.();
    if (typeof vad?.run !== "function") {
      throw new Error("vad-web NonRealTimeVAD adapter must expose a run(pcm, sampleRate) method.");
    }

    const pcm = audio?.pcm ?? audio;
    const sampleRate = audio?.sampleRate ?? audio?.sampleRateHz;
    const audioDurationSeconds = pcm?.length && sampleRate ? pcm.length / sampleRate : undefined;
    const segments = [];
    for await (const segment of vad.run(pcm, sampleRate)) {
      segments.push(normalizeVadWebSegmentTiming(segment, sampleRate, audioDurationSeconds));
    }
    onProgress(100);
    return { segments: splitLongVadSegments(segments) };
  };
}

function splitLongVadSegments(
  segments,
  maxSegmentSeconds = DEFAULT_MAX_SEGMENT_SECONDS,
  minSegmentSeconds = DEFAULT_MIN_SEGMENT_SECONDS,
) {
  if (!Number.isFinite(maxSegmentSeconds) || maxSegmentSeconds <= 0) {
    return segments;
  }
  const bounded = [];
  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    let cursor = start;
    while (end - cursor > maxSegmentSeconds) {
      bounded.push({ ...segment, start: cursor, end: cursor + maxSegmentSeconds });
      cursor += maxSegmentSeconds;
    }
    if (end - cursor >= minSegmentSeconds) {
      bounded.push({ ...segment, start: cursor, end });
    }
  }
  return bounded;
}

function normalizeVadWebSegmentTiming(segment, sampleRate, audioDurationSeconds) {
  return {
    ...segment,
    start: normalizeVadWebTimestamp(segment.start, { audioDurationSeconds, sampleRate }),
    end: normalizeVadWebTimestamp(segment.end, { audioDurationSeconds, sampleRate }),
  };
}

function normalizeVadWebTimestamp(value, { audioDurationSeconds, sampleRate } = {}) {
  if (typeof value !== "number") {
    return value;
  }
  if (!Number.isFinite(value) || value < 0) {
    return value;
  }
  if (typeof audioDurationSeconds === "number" && audioDurationSeconds > 0) {
    const tolerance = Math.max(1, audioDurationSeconds * 0.05);
    if (value <= audioDurationSeconds + tolerance) {
      return value;
    }
    const milliseconds = value / 1000;
    if (milliseconds <= audioDurationSeconds + tolerance) {
      return milliseconds;
    }
    if (typeof sampleRate === "number" && sampleRate > 0) {
      const samples = value / sampleRate;
      if (samples <= audioDurationSeconds + tolerance) {
        return samples;
      }
    }
  }
  return Number.isInteger(value) && value >= 1000 ? value / 1000 : value;
}

function normalizeVadPayload(result) {
  const segments = Array.isArray(result) ? result : result?.segments;
  if (!Array.isArray(segments)) {
    throw new Error("Browser VAD segmenter must return a segments array.");
  }

  return { segments };
}

function normalizeVadMetadata(result) {
  if (Array.isArray(result) || !result || typeof result !== "object") {
    return {};
  }

  const { segments: _segments, diagnostics, ...metadata } = result;
  if (diagnostics !== undefined) {
    metadata.diagnostics = diagnostics;
  }
  return metadata;
}
