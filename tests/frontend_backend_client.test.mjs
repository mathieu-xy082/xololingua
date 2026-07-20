import test from "node:test";
import assert from "node:assert/strict";

import { createBackendClient } from "../frontend/backend_client.js";

class FakeFormData {
  constructor() {
    this.entries = [];
  }

  append(name, value, filename) {
    this.entries.push({ name, value, filename });
  }
}

function jsonResponse(ok, payload) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test("extractAudio checks service health, posts the video, and reports bounded progress", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/health")) {
      return jsonResponse(true, { status: "ok" });
    }
    return jsonResponse(true, {
      audioId: "audio-123",
      audioFileName: "clip.wav",
      audioSizeBytes: 32000,
    });
  };
  const progress = [];
  const client = createBackendClient({
    baseUrl: "http://service.test",
    fetchImpl,
    FormDataImpl: FakeFormData,
  });
  const file = { name: "clip.mp4" };

  const payload = await client.extractAudio(file, (value) => progress.push(value));

  assert.deepEqual(payload, {
    audioId: "audio-123",
    audioFileName: "clip.wav",
    audioSizeBytes: 32000,
  });
  assert.deepEqual(progress, [5, 15, 35]);
  assert.equal(calls[0].url, "http://service.test/api/health");
  assert.equal(calls[1].url, "http://service.test/api/extract-audio");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(calls[1].options.body.entries, [
    { name: "video", value: file, filename: "clip.mp4" },
  ]);
});

test("registerAudio posts browser-extracted WAV audio and reports handoff progress", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse(true, {
      audioId: "registered-123",
      audioFileName: "registered.wav",
      audioSizeBytes: 32768,
    });
  };
  const progress = [];
  const client = createBackendClient({
    baseUrl: "http://service.test",
    fetchImpl,
    FormDataImpl: FakeFormData,
  });
  const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

  const payload = await client.registerAudio({ audioBlob, audioFileName: "clip.wav" }, (value) => progress.push(value));

  assert.deepEqual(payload, {
    audioId: "registered-123",
    audioFileName: "registered.wav",
    audioSizeBytes: 32768,
  });
  assert.deepEqual(progress, [20, 35]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://service.test/api/register-audio");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body.entries, [
    { name: "audio", value: audioBlob, filename: "clip.wav" },
  ]);
});

test("extractAudio exposes local-service unavailability as an explicit fallback reason", async () => {
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async () => jsonResponse(false, { error: "down" }),
    FormDataImpl: FakeFormData,
  });

  await assert.rejects(
    () => client.extractAudio({ name: "clip.mp4" }),
    /Local audio service is not available\./,
  );
});

test("segmentAudio posts an extracted audio id and returns service segments", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse(true, {
      segments: [
        { index: 1, start: 0.25, end: 1.5, text: "Speech segment 1" },
        { index: 2, start: 2.0, end: 3.25, text: "Speech segment 2" },
      ],
    });
  };
  const progress = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl,
    FormDataImpl: FakeFormData,
  });

  const segments = await client.segmentAudio("audio-123", (value) => progress.push(value));

  assert.deepEqual(progress, [10, 100]);
  assert.deepEqual(segments, [
    { index: 1, start: 0.25, end: 1.5, text: "Speech segment 1" },
    { index: 2, start: 2.0, end: 3.25, text: "Speech segment 2" },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://service.test/api/segment-audio");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].options.body, JSON.stringify({ audioId: "audio-123" }));
});

test("transcribeAudio posts extracted audio, source language, and segments", async () => {
  const calls = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, {
        segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
      });
    },
    FormDataImpl: FakeFormData,
  });
  const progress = [];

  const segments = await client.transcribeAudio(
    {
      audioId: "audio-123",
      sourceLanguage: { code: "fr", name: "French" },
      segments: [{ index: 1, start: 0, end: 1.5 }],
    },
    (value) => progress.push(value),
  );

  assert.deepEqual(progress, [{ stage: "transcribing", progress: 5 }, { stage: "transcribing", progress: 100 }]);
  assert.deepEqual(segments, [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://service.test/api/transcribe-audio");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].options.body, JSON.stringify({
    audioId: "audio-123",
    languageCode: "fr",
    segments: [{ index: 1, start: 0, end: 1.5 }],
  }));
});

test("extractAudio surfaces malformed service responses as the fallback error", async () => {
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url) => {
      if (url.endsWith("/api/health")) {
        return jsonResponse(true, { status: "ok" });
      }
      return {
        ok: true,
        async json() {
          throw new SyntaxError("Unexpected token '<'");
        },
      };
    },
    FormDataImpl: FakeFormData,
  });

  await assert.rejects(
    () => client.extractAudio({ name: "clip.mp4" }),
    /Audio extraction failed\./,
  );
});

test("segmentAudio surfaces malformed service responses as the fallback error", async () => {
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        throw new SyntaxError("Unexpected token '<'");
      },
    }),
    FormDataImpl: FakeFormData,
  });

  await assert.rejects(
    () => client.segmentAudio("audio-123"),
    /Audio segmentation failed\./,
  );
});

test("getHealth returns service health from the configured backend URL", async () => {
  const calls = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, {
        whisperBackend: "faster-whisper",
        whisperModel: "base",
        whisperDevice: "cpu",
      });
    },
    FormDataImpl: FakeFormData,
  });

  const health = await client.getHealth();

  assert.deepEqual(health, {
    whisperBackend: "faster-whisper",
    whisperModel: "base",
    whisperDevice: "cpu",
  });
  assert.deepEqual(calls, [{ url: "http://service.test/api/health", options: {} }]);
});

test("getTranslationPairs returns configured service language pairs", async () => {
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url) => {
      assert.equal(url, "http://service.test/api/translation-pairs");
      return jsonResponse(true, {
        pairs: [
          { source: "fr", target: "en" },
          { source: "en", target: "fr" },
        ],
      });
    },
    FormDataImpl: FakeFormData,
  });

  const pairs = await client.getTranslationPairs();

  assert.deepEqual(pairs, [
    { source: "fr", target: "en" },
    { source: "en", target: "fr" },
  ]);
});

test("getTranslationPairs surfaces malformed service responses as the fallback error", async () => {
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        throw new SyntaxError("Unexpected token '<'");
      },
    }),
    FormDataImpl: FakeFormData,
  });

  await assert.rejects(
    () => client.getTranslationPairs(),
    /Translation pairs could not be read\./,
  );
});

test("createSubtitleJob posts extracted audio and selected language details", async () => {
  const calls = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, { jobId: "job-123", stage: "queued" });
    },
    FormDataImpl: FakeFormData,
  });

  const job = await client.createSubtitleJob({
    extractedAudio: { audioId: "audio-123" },
    sourceLanguage: { code: "fr" },
    targetLanguage: "en",
    segments: [{ index: 1, start: 0, end: 1.5 }],
  });

  assert.deepEqual(job, { jobId: "job-123", stage: "queued" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://service.test/api/subtitle-jobs");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].options.body, JSON.stringify({
    audioId: "audio-123",
    sourceLanguage: "fr",
    targetLanguage: "en",
    segments: [{ index: 1, start: 0, end: 1.5 }],
  }));
});

test("translateSegments posts transcribed segments to the Python translation endpoint", async () => {
  const calls = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, {
        segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }],
      });
    },
    FormDataImpl: FakeFormData,
  });
  const progress = [];

  const segments = await client.translateSegments(
    {
      sourceLanguage: { code: "fr" },
      targetLanguage: "en",
      segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
    },
    (value) => progress.push(value),
  );

  assert.deepEqual(progress, [
    { stage: "translating", progress: 10, translationProgress: 10 },
    { stage: "translating", progress: 100, translationProgress: 100 },
  ]);
  assert.deepEqual(segments, [{ index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://service.test/api/translate-segments");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].options.body, JSON.stringify({
    sourceLanguage: "fr",
    targetLanguage: "en",
    segments: [{ index: 1, start: 0, end: 1.5, text: "Bonjour" }],
  }));
});

test("getSubtitleJob and cancelSubtitleJob use the configured backend URL", async () => {
  const calls = [];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, { jobId: "job-123", stage: "cancelled" });
    },
    FormDataImpl: FakeFormData,
  });

  const job = await client.getSubtitleJob("job-123");
  const cancelled = await client.cancelSubtitleJob("job-123");

  assert.deepEqual(job, { jobId: "job-123", stage: "cancelled" });
  assert.deepEqual(cancelled, { jobId: "job-123", stage: "cancelled" });
  assert.deepEqual(calls, [
    { url: "http://service.test/api/subtitle-jobs/job-123", options: {} },
    { url: "http://service.test/api/subtitle-jobs/job-123/cancel", options: { method: "POST" } },
  ]);
});

test("pollSubtitleJob reports progress and returns translated segments when the service succeeds", async () => {
  const calls = [];
  const progress = [];
  const responses = [
    { status: "queued", message: "Queued", transcriptionProgress: 0, translationProgress: 0 },
    { status: "processing", message: "Transcribing", transcriptionProgress: 45, translationProgress: 0 },
    {
      status: "succeeded",
      message: "Complete",
      transcriptionProgress: 100,
      translationProgress: 100,
      segments: [{ index: 1, start: 0, end: 1.5, translatedText: "Hello" }],
    },
  ];
  const client = createBackendClient({
    baseUrl: "http://service.test/",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(true, responses.shift());
    },
    FormDataImpl: FakeFormData,
  });

  const segments = await client.pollSubtitleJob("job-123", {
    delayMs: 0,
    onProgress: (job) => progress.push(job.message),
  });

  assert.deepEqual(segments, [{ index: 1, start: 0, end: 1.5, translatedText: "Hello" }]);
  assert.deepEqual(progress, ["Queued", "Transcribing", "Complete"]);
  assert.deepEqual(calls, [
    { url: "http://service.test/api/subtitle-jobs/job-123", options: { cache: "no-store" } },
    { url: "http://service.test/api/subtitle-jobs/job-123", options: { cache: "no-store" } },
    { url: "http://service.test/api/subtitle-jobs/job-123", options: { cache: "no-store" } },
  ]);
});
