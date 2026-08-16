const DEFAULT_ALIGNMENT_TOLERANCE_SECONDS = 0.35;

export function alignTimestampedTranscriptToVad({
  chunks = [],
  vadSegments = [],
  audioDurationSeconds = 0,
  toleranceSeconds = DEFAULT_ALIGNMENT_TOLERANCE_SECONDS,
} = {}) {
  const normalizedChunks = normalizeWhisperChunks(chunks, audioDurationSeconds);
  const normalizedVad = normalizeVadSegments(vadSegments);

  if (normalizedVad.length === 0) {
    return {
      segments: reindexSegments(normalizedChunks),
      diagnostics: createAlignmentDiagnostics({
        chunks: normalizedChunks,
        vadSegments: normalizedVad,
        alignedChunkCount: 0,
        unmatchedChunkCount: normalizedChunks.length,
        outputSegmentCount: normalizedChunks.length,
      }),
    };
  }

  const textByVadOffset = normalizedVad.map(() => []);
  const unmatchedChunks = [];
  let alignedChunkCount = 0;

  for (const chunk of normalizedChunks) {
    const vadOffset = findBestVadOffset(chunk, normalizedVad, toleranceSeconds);
    if (vadOffset < 0) {
      unmatchedChunks.push(chunk);
      continue;
    }
    textByVadOffset[vadOffset].push(chunk.text);
    alignedChunkCount += 1;
  }

  const alignedSegments = normalizedVad.flatMap((segment, offset) => {
    const text = joinWhisperText(textByVadOffset[offset]);
    return text ? [{ ...segment, text }] : [];
  });
  const segments = reindexSegments(
    [...alignedSegments, ...unmatchedChunks]
      .sort((left, right) => left.start - right.start || left.end - right.end),
  );

  return {
    segments,
    diagnostics: createAlignmentDiagnostics({
      chunks: normalizedChunks,
      vadSegments: normalizedVad,
      alignedChunkCount,
      unmatchedChunkCount: unmatchedChunks.length,
      outputSegmentCount: segments.length,
    }),
  };
}

function normalizeWhisperChunks(chunks, audioDurationSeconds) {
  const source = Array.isArray(chunks) ? chunks : [];
  return source.flatMap((chunk, offset) => {
    const text = String(chunk?.text || "").trim();
    if (!text) return [];

    const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
    const start = finiteNonNegative(timestamp[0], finiteNonNegative(chunk?.start, 0));
    const nextTimestamp = source[offset + 1]?.timestamp;
    const inferredEnd = Array.isArray(nextTimestamp)
      ? finiteNonNegative(nextTimestamp[0], start)
      : finiteNonNegative(audioDurationSeconds, start);
    const end = Math.max(start, finiteNonNegative(timestamp[1], finiteNonNegative(chunk?.end, inferredEnd)));
    return [{ start, end, text }];
  });
}

function normalizeVadSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .flatMap((segment, offset) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return [];
      return [{
        index: segment.index ?? offset + 1,
        start,
        end,
      }];
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function findBestVadOffset(chunk, vadSegments, toleranceSeconds) {
  let bestOffset = -1;
  let bestOverlap = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [offset, segment] of vadSegments.entries()) {
    const overlap = intervalOverlap(chunk, segment);
    const distance = intervalDistance(chunk, segment);
    if (
      overlap > bestOverlap
      || (overlap === bestOverlap && overlap > 0 && distance < bestDistance)
    ) {
      bestOffset = offset;
      bestOverlap = overlap;
      bestDistance = distance;
    } else if (bestOverlap === 0 && distance < bestDistance) {
      bestOffset = offset;
      bestDistance = distance;
    }
  }

  if (bestOverlap > 0) return bestOffset;
  return bestDistance <= Math.max(0, Number(toleranceSeconds) || 0) ? bestOffset : -1;
}

function intervalOverlap(left, right) {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function intervalDistance(left, right) {
  if (intervalOverlap(left, right) > 0) return 0;
  if (left.end < right.start) return right.start - left.end;
  if (right.end < left.start) return left.start - right.end;
  return 0;
}

function joinWhisperText(parts) {
  return parts
    .map((part) => String(part || ""))
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(['’])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function reindexSegments(segments) {
  return segments.map((segment, offset) => ({
    ...segment,
    index: offset + 1,
  }));
}

function finiteNonNegative(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function createAlignmentDiagnostics({
  chunks,
  vadSegments,
  alignedChunkCount,
  unmatchedChunkCount,
  outputSegmentCount,
}) {
  return {
    inputChunkCount: chunks.length,
    vadSegmentCount: vadSegments.length,
    alignedChunkCount,
    unmatchedChunkCount,
    outputSegmentCount,
  };
}

export { DEFAULT_ALIGNMENT_TOLERANCE_SECONDS };
