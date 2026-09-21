export const DEFAULT_LANGUAGE_SAMPLE_COUNT = 10;
export const DEFAULT_LANGUAGE_SAMPLE_SECONDS = 30;

export function createLanguageDetectionWindows(
  durationSeconds,
  {
    sampleCount = DEFAULT_LANGUAGE_SAMPLE_COUNT,
    sampleSeconds = DEFAULT_LANGUAGE_SAMPLE_SECONDS,
  } = {},
) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const count = Math.max(1, Math.trunc(Number(sampleCount) || 0));
  const requestedDuration = Number(sampleSeconds);
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    throw new TypeError("Language detection sample duration must be greater than zero.");
  }

  const clipDuration = Math.min(requestedDuration, duration);
  const maxStart = Math.max(0, duration - clipDuration);
  if (maxStart === 0) return [{ start: 0, duration: clipDuration }];
  if (count === 1) {
    return [{ start: roundMilliseconds(maxStart / 2), duration: clipDuration }];
  }

  return Array.from({ length: count }, (_, index) => ({
    start: roundMilliseconds((maxStart * index) / (count - 1)),
    duration: clipDuration,
  }));
}

export function createLanguageDetectionSamples(
  pcm,
  sampleRate,
  options = {},
) {
  if (!(pcm instanceof Float32Array)) {
    throw new TypeError("Language detection requires Float32 PCM audio.");
  }

  const rate = Number(sampleRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new TypeError("Language detection requires a positive sample rate.");
  }

  return createLanguageDetectionWindows(pcm.length / rate, options).map((window, index) => {
    const startSample = Math.min(pcm.length, Math.max(0, Math.round(window.start * rate)));
    const endSample = Math.min(
      pcm.length,
      Math.max(startSample, Math.round((window.start + window.duration) * rate)),
    );
    return {
      index: index + 1,
      start: window.start,
      duration: (endSample - startSample) / rate,
      pcm: pcm.slice(startSample, endSample),
    };
  });
}

export function languageProbabilitiesFromLogits(logits, langToId) {
  const values = normalizeLogits(logits);
  const languageEntries = Object.entries(langToId || {})
    .map(([token, tokenId]) => ({
      languageCode: parseLanguageCode(token),
      tokenId: Number(tokenId),
    }))
    .filter(({ languageCode, tokenId }) => (
      languageCode
      && Number.isInteger(tokenId)
      && tokenId >= 0
      && tokenId < values.length
      && Number.isFinite(values[tokenId])
    ));

  if (languageEntries.length === 0) {
    throw new Error("Whisper did not expose any usable language token.");
  }

  const maximum = Math.max(...languageEntries.map(({ tokenId }) => values[tokenId]));
  const weighted = languageEntries.map((entry) => ({
    ...entry,
    weight: Math.exp(values[entry.tokenId] - maximum),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  return weighted
    .map(({ weight, ...entry }) => ({ ...entry, probability: weight / total }))
    .sort((left, right) => (
      right.probability - left.probability
      || left.languageCode.localeCompare(right.languageCode)
    ));
}

export function aggregateLanguageDetections(detections) {
  const votes = {};
  const probabilityTotals = {};

  for (const detection of detections || []) {
    const languageCode = String(detection?.languageCode || "").trim().toLowerCase();
    const probability = Number(detection?.probability ?? detection?.languageProbability);
    if (!languageCode || !Number.isFinite(probability)) continue;

    votes[languageCode] = (votes[languageCode] || 0) + 1;
    probabilityTotals[languageCode] = (probabilityTotals[languageCode] || 0) + probability;
  }

  const rankedLanguages = Object.keys(votes).sort((left, right) => (
    votes[right] - votes[left]
    || probabilityTotals[right] - probabilityTotals[left]
    || left.localeCompare(right)
  ));
  const languageCode = rankedLanguages[0];
  if (!languageCode) {
    throw new Error("Language detection did not return any usable result.");
  }

  return {
    languageCode,
    confidence: probabilityTotals[languageCode] / votes[languageCode],
    votes,
    sampleCount: Object.values(votes).reduce((sum, count) => sum + count, 0),
  };
}

function normalizeLogits(logits) {
  const values = logits?.data || logits;
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
    throw new TypeError("Whisper language logits must be an array or typed array.");
  }
  return values;
}

function parseLanguageCode(token) {
  const match = /^<\|([a-z]{2,3})\|>$/i.exec(String(token));
  return match?.[1]?.toLowerCase() || "";
}

function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000;
}
