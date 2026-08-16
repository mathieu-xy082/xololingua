import test from "node:test";
import assert from "node:assert/strict";

import { alignTimestampedTranscriptToVad } from "../frontend/transcription_alignment.js";

test("alignTimestampedTranscriptToVad groups timestamped words inside VAD segments", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [
      { text: "L'", timestamp: [0.2, 0.35] },
      { text: "homme", timestamp: [0.35, 0.7] },
      { text: "arrive", timestamp: [2.1, 2.55] },
      { text: ".", timestamp: [2.55, 2.6] },
    ],
    vadSegments: [
      { index: 7, start: 0.1, end: 0.9 },
      { index: 8, start: 2, end: 3 },
    ],
    audioDurationSeconds: 4,
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 0.1, end: 0.9, text: "L'homme" },
    { index: 2, start: 2, end: 3, text: "arrive." },
  ]);
  assert.deepEqual(result.diagnostics, {
    inputChunkCount: 4,
    vadSegmentCount: 2,
    alignedChunkCount: 4,
    unmatchedChunkCount: 0,
    outputSegmentCount: 2,
    discardedOutOfBoundsChunkCount: 0,
  });
});

test("alignTimestampedTranscriptToVad tolerates small timestamp drift at VAD boundaries", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [{ text: "Bonjour", timestamp: [1.02, 1.18] }],
    vadSegments: [{ start: 1.25, end: 2 }],
    toleranceSeconds: 0.1,
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 1.25, end: 2, text: "Bonjour" },
  ]);
});

test("alignTimestampedTranscriptToVad assigns a spanning chunk to its largest VAD overlap", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [{ text: "Une phrase", timestamp: [0.8, 2.8] }],
    vadSegments: [
      { start: 0, end: 1 },
      { start: 1.2, end: 3 },
    ],
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 1.2, end: 3, text: "Une phrase" },
  ]);
});

test("alignTimestampedTranscriptToVad preserves unmatched Whisper text", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [
      { text: "Reconnu", timestamp: [4, 4.5] },
      { text: "ailleurs", timestamp: [8, 8.5] },
    ],
    vadSegments: [{ start: 3.9, end: 5 }],
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 3.9, end: 5, text: "Reconnu" },
    { index: 2, start: 8, end: 8.5, text: "ailleurs" },
  ]);
  assert.equal(result.diagnostics.unmatchedChunkCount, 1);
});

test("alignTimestampedTranscriptToVad falls back to Whisper timestamps without VAD", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [
      { text: "Premier", timestamp: [0, 0.5] },
      { text: "second", timestamp: [1, null] },
    ],
    audioDurationSeconds: 2,
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 0, end: 0.5, text: "Premier" },
    { index: 2, start: 1, end: 2, text: "second" },
  ]);
});

test("alignTimestampedTranscriptToVad clamps or discards timestamps outside the audio", () => {
  const result = alignTimestampedTranscriptToVad({
    chunks: [
      { text: "conservé", timestamp: [9.5, 12] },
      { text: "halluciné", timestamp: [12, 13] },
    ],
    audioDurationSeconds: 10,
  });

  assert.deepEqual(result.segments, [
    { index: 1, start: 9.5, end: 10, text: "conservé" },
  ]);
  assert.equal(result.diagnostics.discardedOutOfBoundsChunkCount, 1);
});
