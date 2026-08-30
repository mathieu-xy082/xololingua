import test from "node:test";
import assert from "node:assert/strict";
import {
  alignWhisperWordsToVadSegments,
  createWhisperWindows,
  transcribeWhisperInBatches,
} from "../frontend/batched_whisper_runtime.js";

test("Whisper windows use 30 second chunks with symmetric five second overlap", () => {
  const windows = createWhisperWindows(new Float32Array(650), 10);

  assert.deepEqual(
    windows.map(({ offsetSamples, sampleCount, leftStrideSeconds, rightStrideSeconds }) => ({
      offsetSamples,
      sampleCount,
      leftStrideSeconds,
      rightStrideSeconds,
    })),
    [
      { offsetSamples: 0, sampleCount: 300, leftStrideSeconds: 0, rightStrideSeconds: 5 },
      { offsetSamples: 200, sampleCount: 300, leftStrideSeconds: 5, rightStrideSeconds: 5 },
      { offsetSamples: 400, sampleCount: 250, leftStrideSeconds: 5, rightStrideSeconds: 0 },
    ],
  );
});

test("word alignment preserves VAD timestamps and segment indices without duplicating words", () => {
  const alignment = alignWhisperWordsToVadSegments(
    [
      { text: " Bonjour", timestamp: [0.2, 0.8] },
      { text: " le", timestamp: [0.8, 1.1] },
      { text: " monde.", timestamp: [2.2, 2.9] },
      { text: " Trop loin", timestamp: [8, 9] },
    ],
    [
      { index: 7, start: 0, end: 1.2 },
      { index: 9, start: 2, end: 3 },
    ],
  );

  assert.deepEqual(alignment.segments, [
    { index: 7, start: 0, end: 1.2, text: "Bonjour le" },
    { index: 9, start: 2, end: 3, text: "monde." },
  ]);
  assert.deepEqual(alignment.metrics, {
    wordCount: 4,
    assignedWordCount: 3,
    unassignedWordCount: 1,
    outsideVadWordCount: 0,
    wordAssignmentRatio: 0.8,
  });
});

test("generic internal Whisper batching sends four windows through one model.generate call", async () => {
  const generateBatchSizes = [];
  const recognizer = createFakeRecognizer({ generateBatchSizes });

  const result = await transcribeWhisperInBatches({
    recognizer,
    audioInput: new Float32Array(90),
    sampleRate: 10,
    vadSegments: [{ index: 1, start: 0, end: 9 }],
    sourceLanguage: "fr",
    chunkSeconds: 3,
    strideSeconds: 0.5,
    concatenateTensors: concatenateFakeTensors,
  });

  assert.deepEqual(generateBatchSizes, [4]);
  assert.equal(result.metrics.requestedBatchSize, 4);
  assert.equal(result.metrics.effectiveBatchSize, 4);
  assert.equal(result.metrics.windowCount, 4);
  assert.equal(result.metrics.generationCallCount, 1);
  assert.equal(result.segments[0].text, "bonjour monde");
});

test("Whisper-specific batching batches the encoder and keeps decoder generation at batch one", async () => {
  const generateBatchSizes = [];
  const encoderBatchSizes = [];
  const recognizer = createFakeRecognizer({ generateBatchSizes, encoderBatchSizes });

  const result = await transcribeWhisperInBatches({
    recognizer,
    audioInput: new Float32Array(90),
    sampleRate: 10,
    vadSegments: [{ index: 1, start: 0, end: 9 }],
    sourceLanguage: "fr",
    chunkSeconds: 3,
    strideSeconds: 0.5,
    concatenateTensors: concatenateFakeTensors,
  });

  assert.deepEqual(encoderBatchSizes, [4]);
  assert.deepEqual(generateBatchSizes, [1, 1, 1, 1]);
  assert.equal(result.metrics.batchStrategy, "encoder-batch-decoder-sequential");
  assert.equal(result.metrics.encoderBatchCallCount, 1);
  assert.equal(result.metrics.decoderGenerationCallCount, 4);
});

test("internal Whisper batching downgrades from four to two after WebGPU memory pressure", async () => {
  const generateBatchSizes = [];
  let rejectedBatchFour = false;
  let recoveryCount = 0;
  const recognizer = createFakeRecognizer({
    generateBatchSizes,
    failGenerate(batchSize) {
      if (batchSize === 4 && !rejectedBatchFour) {
        rejectedBatchFour = true;
        throw new Error("WebGPU validation failed: Invalid Buffer due to a previous error while calling Device.CreateBindGroup");
      }
    },
  });

  const result = await transcribeWhisperInBatches({
    recognizer,
    audioInput: new Float32Array(110),
    sampleRate: 10,
    vadSegments: [{ index: 1, start: 0, end: 11 }],
    chunkSeconds: 3,
    strideSeconds: 0.5,
    concatenateTensors: concatenateFakeTensors,
    recoverAfterResourceError: async () => {
      recoveryCount += 1;
      return recognizer;
    },
  });

  assert.deepEqual(generateBatchSizes, [4, 2, 2, 1]);
  assert.equal(result.metrics.effectiveBatchSize, 2);
  assert.equal(result.metrics.attemptedGenerationCallCount, 4);
  assert.equal(result.metrics.generationCallCount, 3);
  assert.equal(result.metrics.runtimeRestartCount, 1);
  assert.equal(recoveryCount, 1);
  assert.match(result.metrics.downgradeReason, /invalid buffer/i);
});

function createFakeRecognizer({ generateBatchSizes, encoderBatchSizes, failGenerate = () => {} }) {
  const processor = async () => ({
    input_features: { dims: [1, 2, 3] },
  });
  processor.feature_extractor = {
    config: {
      sampling_rate: 10,
      hop_length: 1,
      chunk_length: 3,
    },
  };

  const model = {
    config: { max_source_positions: 150 },
    async generate({ inputs, language, task, return_token_timestamps, return_timestamps, max_new_tokens }) {
      const batchSize = inputs.dims[0];
      generateBatchSizes.push(batchSize);
      failGenerate(batchSize);
      assert.equal(language, language || undefined);
      assert.equal(task, "transcribe");
      assert.equal(return_token_timestamps, true);
      assert.equal(return_timestamps, true);
      assert.equal(max_new_tokens, 440);
      return {
        sequences: {
          tolist: () => Array.from({ length: batchSize }, () => [1n, 2n, 3n]),
        },
        token_timestamps: {
          tolist: () => Array.from({ length: batchSize }, () => [0, 0.1, 0.2]),
        },
      };
    },
  };
  if (encoderBatchSizes) {
    model.main_input_name = "input_features";
    model._prepare_generation_config = () => ({});
    model._prepare_encoder_decoder_kwargs_for_generation = async ({ inputs_tensor }) => {
      encoderBatchSizes.push(inputs_tensor.dims[0]);
      return {
        encoder_outputs: {
          slice: () => ({ dims: [1, 2, 3], dispose() {} }),
          dispose() {},
        },
      };
    };
  }

  return {
    processor,
    model,
    tokenizer: {
      timestamp_begin: 50_000,
      _decode_asr(chunks, options) {
        assert.ok(chunks.length > 0);
        assert.equal(options.return_timestamps, "word");
        return [
          "bonjour monde",
          {
            chunks: [
              { text: "bonjour", timestamp: [0.1, 0.8] },
              { text: " monde", timestamp: [1, 1.8] },
            ],
          },
        ];
      },
    },
  };
}

function concatenateFakeTensors(tensors) {
  return { dims: [tensors.length, ...tensors[0].dims.slice(1)] };
}
