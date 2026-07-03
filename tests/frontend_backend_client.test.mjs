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
