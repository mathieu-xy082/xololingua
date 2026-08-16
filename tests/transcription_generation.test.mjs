import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateWhisperTokenBudget,
  MAX_WHISPER_NEW_TOKENS,
} from "../frontend/transcription_generation.js";

test("Whisper token budget scales with audio while preserving a safe floor and ceiling", () => {
  assert.equal(calculateWhisperTokenBudget(0), 16);
  assert.equal(calculateWhisperTokenBudget(1), 16);
  assert.equal(calculateWhisperTokenBudget(12), 72);
  assert.equal(calculateWhisperTokenBudget(30), 180);
  assert.equal(calculateWhisperTokenBudget(120), MAX_WHISPER_NEW_TOKENS);
});
