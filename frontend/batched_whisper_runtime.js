const DEFAULT_CHUNK_SECONDS = 30;
const DEFAULT_STRIDE_SECONDS = 5;
const DEFAULT_BATCH_SIZE = 4;

export class BatchedWhisperRuntimeError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "BatchedWhisperRuntimeError";
  }
}

export function createWhisperWindows(
  audioInput,
  sampleRate,
  { chunkSeconds = DEFAULT_CHUNK_SECONDS, strideSeconds = DEFAULT_STRIDE_SECONDS } = {},
) {
  if (!(audioInput instanceof Float32Array)) {
    throw new TypeError("Batched Whisper requires Float32 PCM audio.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError("Batched Whisper requires a positive sample rate.");
  }
  if (!(chunkSeconds > 0) || !(strideSeconds >= 0) || chunkSeconds <= 2 * strideSeconds) {
    throw new RangeError("Whisper chunk length must exceed twice its stride length.");
  }

  const chunkSamples = Math.round(chunkSeconds * sampleRate);
  const strideSamples = Math.round(strideSeconds * sampleRate);
  const jumpSamples = chunkSamples - 2 * strideSamples;
  const windows = [];
  let offsetSamples = 0;

  while (offsetSamples < audioInput.length || windows.length === 0) {
    const endSamples = Math.min(audioInput.length, offsetSamples + chunkSamples);
    const isFirst = offsetSamples === 0;
    const isLast = endSamples >= audioInput.length;
    const pcm = audioInput.subarray(offsetSamples, endSamples);
    windows.push({
      index: windows.length,
      pcm,
      offsetSamples,
      offsetSeconds: offsetSamples / sampleRate,
      sampleCount: pcm.length,
      durationSeconds: pcm.length / sampleRate,
      leftStrideSeconds: isFirst ? 0 : strideSeconds,
      rightStrideSeconds: isLast ? 0 : strideSeconds,
      isFirst,
      isLast,
    });
    if (isLast) break;
    offsetSamples += jumpSamples;
  }
  return windows;
}

export async function transcribeWhisperInBatches({
  recognizer,
  audioInput,
  sampleRate,
  vadSegments,
  sourceLanguage = "auto",
  initialBatchSize = DEFAULT_BATCH_SIZE,
  chunkSeconds = DEFAULT_CHUNK_SECONDS,
  strideSeconds = DEFAULT_STRIDE_SECONDS,
  onProgress = () => {},
  now = defaultNow,
  concatenateTensors,
  recoverAfterResourceError,
} = {}) {
  let activeRecognizer = recognizer;
  assertRecognizerInternals(activeRecognizer);
  const featureConfig = activeRecognizer.processor.feature_extractor?.config || {};
  const expectedSampleRate = Number(featureConfig.sampling_rate || sampleRate);
  if (Number(sampleRate) !== expectedSampleRate) {
    throw new BatchedWhisperRuntimeError(
      `Batched Whisper expected ${expectedSampleRate} Hz PCM but received ${sampleRate} Hz.`,
    );
  }

  const startedAt = now();
  const windows = createWhisperWindows(audioInput, sampleRate, { chunkSeconds, strideSeconds });
  const hopLength = Number(featureConfig.hop_length);
  const modelChunkLength = Number(featureConfig.chunk_length || chunkSeconds);
  const maxSourcePositions = Number(activeRecognizer.model.config?.max_source_positions);
  if (!(hopLength > 0) || !(modelChunkLength > 0) || !(maxSourcePositions > 0)) {
    throw new BatchedWhisperRuntimeError("Whisper processor metadata is incomplete for batched decoding.");
  }

  const timePrecision = modelChunkLength / maxSourcePositions;
  const requestedBatchSize = normalizeBatchSize(initialBatchSize);
  let effectiveBatchSize = requestedBatchSize;
  let offset = 0;
  let preparationMs = 0;
  let inferenceMs = 0;
  let generationCallCount = 0;
  let attemptedGenerationCallCount = 0;
  let runtimeRestartCount = 0;
  let encoderBatchCallCount = 0;
  let decoderGenerationCallCount = 0;
  let batchStrategy = "full-generate-batch";
  let downgradeReason = "";
  const generateBatchSizes = [];
  const decodedWindows = [];

  while (offset < windows.length) {
    const selected = selectCompatibleWindows(windows, offset, effectiveBatchSize, hopLength);
    const preparationStartedAt = now();
    const features = await Promise.all(selected.map(async (window) => {
      const prepared = await activeRecognizer.processor(window.pcm);
      if (!prepared?.input_features) {
        throw new BatchedWhisperRuntimeError("Whisper processor did not return input_features.");
      }
      return prepared.input_features;
    }));
    preparationMs += elapsed(preparationStartedAt, now);

    if (features.length > 1 && typeof concatenateTensors !== "function") {
      throw new BatchedWhisperRuntimeError("Batched Whisper requires a tensor concatenation function.");
    }
    const inputs = features.length === 1 ? features[0] : concatenateTensors(features, 0);
    const inferenceStartedAt = now();
    attemptedGenerationCallCount += 1;
    let generated;
    try {
      const generationOptions = {
        return_token_timestamps: true,
        return_timestamps: true,
        max_new_tokens: 440,
        num_frames: Math.floor(selected[0].sampleCount / hopLength),
        task: "transcribe",
        ...(normalizeLanguage(sourceLanguage) ? { language: normalizeLanguage(sourceLanguage) } : {}),
      };
      const batchResult = await generateWhisperBatch({
        recognizer: activeRecognizer,
        features,
        inputs,
        generationOptions,
      });
      generated = batchResult.outputs;
      batchStrategy = batchResult.strategy;
      encoderBatchCallCount += batchResult.encoderBatchCallCount;
      decoderGenerationCallCount += batchResult.decoderGenerationCallCount;
    } catch (error) {
      inferenceMs += elapsed(inferenceStartedAt, now);
      if (selected.length > 1 && isLikelyWebGpuMemoryError(error)) {
        const previousBatchSize = effectiveBatchSize;
        effectiveBatchSize = previousBatchSize >= 4 ? 2 : 1;
        downgradeReason = errorMessage(error);
        if (typeof recoverAfterResourceError === "function") {
          try {
            activeRecognizer = await recoverAfterResourceError({
              error,
              previousBatchSize,
              nextBatchSize: effectiveBatchSize,
            });
            assertRecognizerInternals(activeRecognizer);
            runtimeRestartCount += 1;
          } catch (recoveryError) {
            throw new BatchedWhisperRuntimeError(
              `Whisper WebGPU runtime recovery failed after batch ${previousBatchSize}: ${errorMessage(recoveryError)}`,
              { cause: recoveryError },
            );
          }
        } else {
          throw new BatchedWhisperRuntimeError(
            `Whisper WebGPU batch ${previousBatchSize} invalidated the GPU context; retry batch ${effectiveBatchSize} in a fresh worker. ${downgradeReason}`,
            { cause: error },
          );
        }
        onProgress({
          completedWindows: offset,
          windowCount: windows.length,
          batchSize: effectiveBatchSize,
          downgradedFrom: previousBatchSize,
          downgradeReason,
        });
        continue;
      }
      throw new BatchedWhisperRuntimeError(
        `Internal Whisper batch generation failed at batch ${selected.length}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    inferenceMs += elapsed(inferenceStartedAt, now);
    generationCallCount += 1;
    generateBatchSizes.push(selected.length);
    decodedWindows.push(...decodeGeneratedBatch({
      generated,
      windows: selected,
      tokenizer: activeRecognizer.tokenizer,
    }));
    offset += selected.length;
    onProgress({
      completedWindows: offset,
      windowCount: windows.length,
      batchSize: effectiveBatchSize,
      generatedBatchSize: selected.length,
    });
  }

  let decoded;
  try {
    const [text, optional] = activeRecognizer.tokenizer._decode_asr(decodedWindows, {
      time_precision: timePrecision,
      return_timestamps: "word",
      force_full_sequences: false,
    });
    decoded = { text: String(text || "").trim(), words: optional?.chunks || [] };
  } catch (error) {
    throw new BatchedWhisperRuntimeError(`Batched Whisper decoding failed: ${errorMessage(error)}`, { cause: error });
  }
  if (decoded.text && decoded.words.length === 0) {
    throw new BatchedWhisperRuntimeError("Batched Whisper produced text without word timestamps.");
  }

  const alignment = alignWhisperWordsToVadSegments(decoded.words, vadSegments);
  return {
    text: decoded.text,
    segments: alignment.segments,
    metrics: {
      mode: effectiveBatchSize > 1 ? "webgpu-internal-batch" : "webgpu-direct-windowed",
      requestedBatchSize,
      effectiveBatchSize,
      windowCount: windows.length,
      generationCallCount,
      attemptedGenerationCallCount,
      runtimeRestartCount,
      encoderBatchCallCount,
      decoderGenerationCallCount,
      batchStrategy,
      generateBatchSizes,
      downgradeReason,
      audioSeconds: round(audioInput.length / sampleRate),
      preparationMs: round(preparationMs),
      inferenceMs: round(inferenceMs),
      transcriptionWallMs: elapsed(startedAt, now),
      realtimeFactor: calculateRealtimeFactor(inferenceMs, audioInput.length / sampleRate),
      ...alignment.metrics,
    },
  };
}

export function alignWhisperWordsToVadSegments(words, vadSegments, { toleranceSeconds = 1 } = {}) {
  const segments = (Array.isArray(vadSegments) ? vadSegments : []).map((segment, position) => ({
    index: segment.index ?? position + 1,
    start: finiteNumber(segment.start, 0),
    end: finiteNumber(segment.end, finiteNumber(segment.start, 0)),
    textParts: [],
  }));
  let assignedWordCount = 0;
  let unassignedWordCount = 0;
  let outsideVadWordCount = 0;

  for (const word of Array.isArray(words) ? words : []) {
    const text = String(word?.text || "");
    if (!text) continue;
    const timestamp = Array.isArray(word?.timestamp) ? word.timestamp : [];
    const start = finiteNumber(timestamp[0], NaN);
    const end = finiteNumber(timestamp[1], start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || segments.length === 0) {
      unassignedWordCount += 1;
      continue;
    }

    let best = null;
    for (const segment of segments) {
      const overlap = Math.max(0, Math.min(end, segment.end) - Math.max(start, segment.start));
      const distance = intervalDistance(start, end, segment.start, segment.end);
      if (!best || overlap > best.overlap || (overlap === best.overlap && distance < best.distance)) {
        best = { segment, overlap, distance };
      }
    }
    if (!best || (best.overlap <= 0 && best.distance > toleranceSeconds)) {
      unassignedWordCount += 1;
      continue;
    }
    if (best.overlap <= 0) outsideVadWordCount += 1;
    best.segment.textParts.push(text);
    assignedWordCount += 1;
  }

  return {
    segments: segments.map(({ textParts, ...segment }) => ({
      ...segment,
      text: textParts.join("").trim(),
    })),
    metrics: {
      wordCount: assignedWordCount + unassignedWordCount,
      assignedWordCount,
      unassignedWordCount,
      outsideVadWordCount,
      wordAssignmentRatio: assignedWordCount + unassignedWordCount > 0
        ? round(assignedWordCount / (assignedWordCount + unassignedWordCount))
        : 1,
    },
  };
}

function decodeGeneratedBatch({ generated, windows, tokenizer }) {
  if (Array.isArray(generated)) {
    const sequenceRows = [];
    const timestampRows = [];
    for (const output of generated) {
      const outputSequences = output?.sequences?.tolist?.();
      const outputTimestamps = output?.token_timestamps?.tolist?.();
      if (!Array.isArray(outputSequences) || !Array.isArray(outputTimestamps) || outputSequences.length !== 1) {
        throw new BatchedWhisperRuntimeError("Sequential Whisper decoding returned an invalid batched output.");
      }
      sequenceRows.push(outputSequences[0]);
      timestampRows.push(outputTimestamps[0]);
    }
    return decodeGeneratedRows({ sequenceRows, timestampRows, windows, tokenizer });
  }
  const sequenceRows = generated?.sequences?.tolist?.();
  const timestampRows = generated?.token_timestamps?.tolist?.();
  if (!Array.isArray(sequenceRows) || !Array.isArray(timestampRows)) {
    throw new BatchedWhisperRuntimeError("Whisper batch generation omitted token timestamp tensors.");
  }
  if (sequenceRows.length !== windows.length || timestampRows.length !== windows.length) {
    throw new BatchedWhisperRuntimeError(
      `Whisper returned ${sequenceRows.length} sequences for ${windows.length} input windows.`,
    );
  }
  return decodeGeneratedRows({ sequenceRows, timestampRows, windows, tokenizer });
}

function decodeGeneratedRows({ sequenceRows, timestampRows, windows, tokenizer }) {
  const timestampBegin = Number(tokenizer.timestamp_begin);
  return windows.map((window, index) => {
    const tokens = sequenceRows[index];
    const tokenTimestamps = timestampRows[index];
    if (!Array.isArray(tokens) || !Array.isArray(tokenTimestamps) || tokens.length !== tokenTimestamps.length) {
      throw new BatchedWhisperRuntimeError(`Whisper returned invalid token timestamps for window ${window.index + 1}.`);
    }
    const firstTimestampToken = tokens.findIndex((token) => Number(token) >= timestampBegin);
    const prefixLength = firstTimestampToken >= 0 ? firstTimestampToken : 0;
    return {
      tokens: tokens.slice(prefixLength),
      token_timestamps: tokenTimestamps.slice(prefixLength).map((value) => round(value, 2)),
      stride: [window.durationSeconds, window.leftStrideSeconds, window.rightStrideSeconds],
    };
  });
}

async function generateWhisperBatch({ recognizer, features, inputs, generationOptions }) {
  const model = recognizer.model;
  if (
    features.length <= 1
    || typeof model._prepare_generation_config !== "function"
    || typeof model._prepare_encoder_decoder_kwargs_for_generation !== "function"
  ) {
    return {
      outputs: await model.generate({ inputs, ...generationOptions }),
      strategy: features.length > 1 ? "full-generate-batch" : "sequential-generate",
      encoderBatchCallCount: 0,
      decoderGenerationCallCount: 1,
    };
  }

  const modelInputName = model.main_input_name || "input_features";
  const generationConfig = model._prepare_generation_config(null, generationOptions);
  const prepared = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: inputs,
    model_inputs: { [modelInputName]: inputs },
    model_input_name: modelInputName,
    generation_config: generationConfig,
  });
  const batchedEncoderOutputs = prepared?.encoder_outputs;
  if (!batchedEncoderOutputs?.slice) {
    throw new BatchedWhisperRuntimeError("Whisper encoder batching did not return sliceable encoder outputs.");
  }

  const outputs = [];
  try {
    for (let index = 0; index < features.length; index += 1) {
      const encoderOutputs = batchedEncoderOutputs.slice([index, index + 1], null, null);
      try {
        outputs.push(await model.generate({
          inputs: features[index],
          encoder_outputs: encoderOutputs,
          ...generationOptions,
        }));
      } finally {
        encoderOutputs.dispose?.();
      }
    }
  } finally {
    batchedEncoderOutputs.dispose?.();
  }
  return {
    outputs,
    strategy: "encoder-batch-decoder-sequential",
    encoderBatchCallCount: 1,
    decoderGenerationCallCount: features.length,
  };
}

function selectCompatibleWindows(windows, offset, batchSize, hopLength) {
  const first = windows[offset];
  const firstFrameCount = Math.floor(first.sampleCount / hopLength);
  const selected = [first];
  for (let index = offset + 1; index < windows.length && selected.length < batchSize; index += 1) {
    const candidate = windows[index];
    if (Math.floor(candidate.sampleCount / hopLength) !== firstFrameCount) break;
    selected.push(candidate);
  }
  return selected;
}

function assertRecognizerInternals(recognizer) {
  if (!recognizer?.processor || !recognizer?.model?.generate || !recognizer?.tokenizer?._decode_asr) {
    throw new BatchedWhisperRuntimeError("The loaded Transformers.js ASR pipeline does not expose Whisper internals.");
  }
}

function normalizeBatchSize(value) {
  const batchSize = Math.max(1, Math.min(DEFAULT_BATCH_SIZE, Math.floor(Number(value) || DEFAULT_BATCH_SIZE)));
  if (batchSize >= 4) return 4;
  if (batchSize >= 2) return 2;
  return 1;
}

function normalizeLanguage(language) {
  const value = typeof language === "string" ? language : language?.code;
  return value && value !== "auto" ? value : "";
}

function isLikelyWebGpuMemoryError(error) {
  const message = errorMessage(error).toLowerCase();
  return /out of memory|\boom\b|allocation failed|failed to allocate|resource exhausted|device lost|invalid buffer.*previous error|createbindgroup|binding size|exceeds.*limit/.test(message);
}

function intervalDistance(leftStart, leftEnd, rightStart, rightEnd) {
  if (leftEnd < rightStart) return rightStart - leftEnd;
  if (rightEnd < leftStart) return leftStart - rightEnd;
  return 0;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateRealtimeFactor(inferenceMs, audioSeconds) {
  return audioSeconds > 0 ? round((inferenceMs / 1000) / audioSeconds) : 0;
}

function elapsed(startedAt, now) {
  return round(Math.max(0, now() - startedAt));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function defaultNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function errorMessage(error) {
  return String(error?.message || error || "Unknown error");
}
