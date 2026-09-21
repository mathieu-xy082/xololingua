import {
  LogitsProcessor,
  LogitsProcessorList,
} from "../node_modules/@huggingface/transformers/dist/transformers.min.js";
import { languageProbabilitiesFromLogits } from "./browser_language_detection.js";

export async function detectWhisperLanguageSample(recognizer, pcm) {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) {
    throw new TypeError("Whisper language detection requires a non-empty Float32 PCM sample.");
  }
  if (typeof recognizer?.processor !== "function" || typeof recognizer?.model?.generate !== "function") {
    throw new Error("The loaded Whisper pipeline does not expose its processor and model.");
  }

  const generationConfig = recognizer.model.generation_config;
  const decoderStartTokenId = Number(generationConfig?.decoder_start_token_id);
  if (!Number.isInteger(decoderStartTokenId)) {
    throw new Error("Whisper did not expose its start-of-transcript token.");
  }

  const capture = new CaptureLanguageLogitsProcessor();
  const processors = new LogitsProcessorList();
  processors.push(capture);
  let processed;
  let generated;
  try {
    processed = await recognizer.processor(pcm);
    if (!processed?.input_features) {
      throw new Error("Whisper could not prepare language detection features.");
    }
    generated = await recognizer.model.generate({
      inputs: processed.input_features,
      decoder_input_ids: [decoderStartTokenId],
      max_new_tokens: 1,
      return_timestamps: false,
      do_sample: false,
      logits_processor: processors,
    });
    if (!capture.logits) {
      throw new Error("Whisper did not expose first-token language scores.");
    }

    const probabilities = languageProbabilitiesFromLogits(
      capture.logits,
      generationConfig?.lang_to_id,
    );
    const best = probabilities[0];
    return {
      languageCode: best.languageCode,
      probability: best.probability,
      probabilities,
    };
  } finally {
    disposeTensor(generated);
    disposeTensor(processed?.input_features);
  }
}

class CaptureLanguageLogitsProcessor extends LogitsProcessor {
  _call(_inputIds, logits) {
    const values = logits?.data;
    if (!ArrayBuffer.isView(values)) {
      throw new Error("Whisper returned inaccessible language logits.");
    }
    this.logits = Float32Array.from(values);
    return logits;
  }
}

function disposeTensor(value) {
  if (value && typeof value.dispose === "function") value.dispose();
}
