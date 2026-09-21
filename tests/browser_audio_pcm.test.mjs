import test from "node:test";
import assert from "node:assert/strict";

import { prepareBrowserPcmAudio } from "../frontend/browser_audio_pcm.js";

test("browser PCM preparation decodes the first channel and closes its AudioContext", async () => {
  let closed = false;
  class AudioContext {
    constructor(options) {
      assert.deepEqual(options, { sampleRate: 16_000 });
    }
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 2);
      return {
        sampleRate: 16_000,
        numberOfChannels: 1,
        duration: 2 / 16_000,
        getChannelData: () => new Float32Array([0.25, -0.25]),
      };
    }
    async close() {
      closed = true;
    }
  }
  const result = await prepareBrowserPcmAudio({
    audioBlob: { arrayBuffer: async () => new Uint8Array([1, 2]).buffer },
    sampleRate: 16_000,
  }, { AudioContext }, { required: true });

  assert.deepEqual(result.pcm, new Float32Array([0.25, -0.25]));
  assert.equal(result.durationSeconds, 2 / 16_000);
  assert.equal(closed, true);
});

test("browser PCM preparation can require a decodable input", async () => {
  await assert.rejects(
    prepareBrowserPcmAudio({ audioId: "server-only" }, {}, { required: true }),
    /decodable audio Blob or Float32 PCM/,
  );
});
