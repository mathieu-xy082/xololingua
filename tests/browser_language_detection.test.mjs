import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateLanguageDetections,
  createLanguageDetectionSamples,
  createLanguageDetectionWindows,
  languageProbabilitiesFromLogits,
} from "../frontend/browser_language_detection.js";

test("language detection uses ten evenly spaced windows for a long video", () => {
  const duration = 70 * 60;
  const windows = createLanguageDetectionWindows(duration);

  assert.equal(windows.length, 10);
  assert.deepEqual(windows[0], { start: 0, duration: 30 });
  assert.deepEqual(windows.at(-1), { start: duration - 30, duration: 30 });
  assert.equal(new Set(windows.map(({ start }) => start)).size, 10);
});

test("language detection uses one complete window for a short video", () => {
  assert.deepEqual(createLanguageDetectionWindows(12), [{ start: 0, duration: 12 }]);
});

test("language detection centers a single sample and rejects invalid sample durations", () => {
  assert.deepEqual(
    createLanguageDetectionWindows(100, { sampleCount: 1, sampleSeconds: 30 }),
    [{ start: 35, duration: 30 }],
  );
  assert.throws(
    () => createLanguageDetectionWindows(100, { sampleSeconds: 0 }),
    /greater than zero/,
  );
});

test("language samples copy only the selected PCM windows", () => {
  const pcm = Float32Array.from({ length: 100 }, (_, index) => index);
  const samples = createLanguageDetectionSamples(pcm, 10, {
    sampleCount: 3,
    sampleSeconds: 2,
  });

  assert.deepEqual(samples.map(({ start, duration, pcm: sample }) => ({
    start,
    duration,
    length: sample.length,
    first: sample[0],
    last: sample.at(-1),
  })), [
    { start: 0, duration: 2, length: 20, first: 0, last: 19 },
    { start: 4, duration: 2, length: 20, first: 40, last: 59 },
    { start: 8, duration: 2, length: 20, first: 80, last: 99 },
  ]);
  assert.notEqual(samples[0].pcm.buffer, pcm.buffer);
});

test("language probabilities apply softmax only to Whisper language tokens", () => {
  const probabilities = languageProbabilitiesFromLogits(
    new Float32Array([100, 0, 2, 1]),
    { "<|en|>": 1, "<|fr|>": 2, "<|ru|>": 3, "<|transcribe|>": 0 },
  );

  assert.deepEqual(probabilities.map(({ languageCode, tokenId }) => ({ languageCode, tokenId })), [
    { languageCode: "fr", tokenId: 2 },
    { languageCode: "ru", tokenId: 3 },
    { languageCode: "en", tokenId: 1 },
  ]);
  assert.ok(Math.abs(probabilities.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);
  assert.ok(Math.abs(probabilities[0].probability - 0.6652409557748218) < 1e-7);
});

test("language aggregation ranks votes before cumulative probability", () => {
  assert.deepEqual(aggregateLanguageDetections([
    { languageCode: "ru", probability: 0.8 },
    { languageCode: "uk", probability: 0.99 },
    { languageCode: "ru", probability: 0.6 },
  ]), {
    languageCode: "ru",
    confidence: 0.7,
    votes: { ru: 2, uk: 1 },
    sampleCount: 3,
  });
});

test("language aggregation uses cumulative probability to break a vote tie", () => {
  const result = aggregateLanguageDetections([
    { languageCode: "fr", probability: 0.7 },
    { languageCode: "ru", probability: 0.9 },
  ]);

  assert.equal(result.languageCode, "ru");
  assert.equal(result.confidence, 0.9);
  assert.throws(() => aggregateLanguageDetections([]), /usable result/);
});
