import { normalizeVadStageResult } from "./pipeline_stage_contract.js";

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
    const segments = [];
    for await (const segment of vad.run(pcm, sampleRate)) {
      segments.push(normalizeVadWebSegmentTiming(segment, sampleRate));
    }
    onProgress(100);
    return { segments };
  };
}

function normalizeVadWebSegmentTiming(segment, sampleRate) {
  return {
    ...segment,
    start: normalizeVadWebTimestamp(segment.start, sampleRate),
    end: normalizeVadWebTimestamp(segment.end, sampleRate),
  };
}

function normalizeVadWebTimestamp(value, sampleRate) {
  if (typeof value !== "number" || typeof sampleRate !== "number" || sampleRate <= 0) {
    return value;
  }
  return Number.isInteger(value) && value >= 1000 ? value / sampleRate : value;
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
