import test from "node:test";
import assert from "node:assert/strict";

import { detectWhisperLanguageSample } from "../frontend/whisper_language_detector.js";

test("Whisper language detection captures first-token scores from a start-only prompt", async () => {
  let featureDisposed = false;
  let outputDisposed = false;
  const inputFeatures = { dispose: () => { featureDisposed = true; } };
  const recognizer = {
    processor: async (pcm) => {
      assert.deepEqual(pcm, new Float32Array([0.1, -0.1]));
      return { input_features: inputFeatures };
    },
    model: {
      generation_config: {
        decoder_start_token_id: 50_258,
        lang_to_id: { "<|en|>": 1, "<|fr|>": 2, "<|ru|>": 3 },
      },
      async generate(options) {
        assert.equal(options.inputs, inputFeatures);
        assert.deepEqual(options.decoder_input_ids, [50_258]);
        assert.equal(options.max_new_tokens, 1);
        assert.equal(options.return_timestamps, false);
        for (const processor of options.logits_processor) {
          processor([[50_258n]], { data: new Float32Array([0, 1, 4, 2]) });
        }
        return { dispose: () => { outputDisposed = true; } };
      },
    },
  };

  const result = await detectWhisperLanguageSample(recognizer, new Float32Array([0.1, -0.1]));

  assert.equal(result.languageCode, "fr");
  assert.ok(result.probability > 0.84);
  assert.equal(featureDisposed, true);
  assert.equal(outputDisposed, true);
});
