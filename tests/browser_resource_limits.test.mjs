import test from "node:test";
import assert from "node:assert/strict";

import { BROWSER_ML_CONFIG } from "../frontend/browser_ml_config.js";
import {
  BROWSER_MAX_MEDIA_DURATION_SECONDS,
  BROWSER_MAX_VIDEO_BYTES,
} from "../frontend/browser_resource_limits.js";

test("browser media stages share a one-hour video ceiling", () => {
  assert.equal(BROWSER_MAX_MEDIA_DURATION_SECONDS, 3600);
  assert.equal(BROWSER_ML_CONFIG.vad.maxAudioSeconds, 3600);
  assert.equal(BROWSER_ML_CONFIG.transcription.maxAudioSeconds, 3600);
  assert.equal(BROWSER_ML_CONFIG.translation.maxMediaSeconds, 3600);
  assert.equal(BROWSER_MAX_VIDEO_BYTES, 400 * 1024 * 1024);
});
