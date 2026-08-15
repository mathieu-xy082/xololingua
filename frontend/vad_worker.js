importScripts("/node_modules/onnxruntime-web/dist/ort.min.js");
importScripts("/node_modules/@ricky0123/vad-web/dist/bundle.min.js");

const DEFAULT_CHUNK_SECONDS = 30;
const VAD_FRAME_SAMPLES = 1536;

self.onmessage = async (event) => {
  const message = event?.data || {};
  if (message.type !== "segment") {
    self.postMessage({ type: "error", error: `Unsupported VAD worker message type: ${message.type || "unknown"}.` });
    return;
  }

  try {
    const result = await segmentPcm(message.request || {});
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function segmentPcm({
  audioBuffer,
  modelURL,
  ortWasmBasePath,
  vadOptions = {},
  chunkSeconds = DEFAULT_CHUNK_SECONDS,
} = {}) {
  if (!(audioBuffer instanceof ArrayBuffer)) {
    throw new Error("VAD worker requires a transferred WAV ArrayBuffer.");
  }
  if (typeof self.vad?.NonRealTimeVAD?.new !== "function") {
    throw new Error("vad-web failed to load in the VAD worker.");
  }

  const { pcm, sampleRate } = decodeWavPcm(audioBuffer);
  self.postMessage({ type: "progress", progress: 20 });
  const detector = await self.vad.NonRealTimeVAD.new({
    modelURL,
    ...vadOptions,
    ortConfig: (ort) => {
      ort.env.wasm.wasmPaths = ortWasmBasePath;
      ort.env.wasm.numThreads = 1;
    },
  });
  self.postMessage({ type: "progress", progress: 35 });

  const requestedChunkSamples = Math.max(VAD_FRAME_SAMPLES, Math.floor(sampleRate * chunkSeconds));
  const chunkSamples = Math.max(
    VAD_FRAME_SAMPLES,
    Math.floor(requestedChunkSamples / VAD_FRAME_SAMPLES) * VAD_FRAME_SAMPLES,
  );
  const segments = [];

  for (let startSample = 0; startSample < pcm.length; startSample += chunkSamples) {
    const endSample = Math.min(pcm.length, startSample + chunkSamples);
    const chunk = pcm.subarray(startSample, endSample);
    const offsetMilliseconds = (startSample / sampleRate) * 1000;
    for await (const segment of detector.run(chunk, sampleRate)) {
      segments.push({
        start: Number(segment.start || 0) + offsetMilliseconds,
        end: Number(segment.end || segment.start || 0) + offsetMilliseconds,
      });
    }
    const processedRatio = endSample / Math.max(1, pcm.length);
    self.postMessage({
      type: "progress",
      progress: Math.min(95, 35 + Math.round(processedRatio * 60)),
    });
  }

  return {
    segments,
    rawSegmentCount: segments.length,
    pcmSampleCount: pcm.length,
    sourceSampleRate: sampleRate,
  };
}

function decodeWavPcm(audioBuffer) {
  const view = new DataView(audioBuffer);
  if (view.byteLength < 44 || readFourCc(view, 0) !== "RIFF" || readFourCc(view, 8) !== "WAVE") {
    throw new Error("VAD worker received an invalid RIFF/WAVE audio file.");
  }

  let format = null;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const chunkId = readFourCc(view, offset);
    const declaredSize = view.getUint32(offset + 4, true);
    const chunkOffset = offset + 8;
    const availableSize = Math.min(declaredSize, Math.max(0, view.byteLength - chunkOffset));

    if (chunkId === "fmt " && availableSize >= 16) {
      format = {
        audioFormat: view.getUint16(chunkOffset, true),
        channelCount: view.getUint16(chunkOffset + 2, true),
        sampleRate: view.getUint32(chunkOffset + 4, true),
        blockAlign: view.getUint16(chunkOffset + 12, true),
        bitsPerSample: view.getUint16(chunkOffset + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkOffset;
      dataSize = availableSize;
    }

    const nextOffset = chunkOffset + declaredSize + (declaredSize % 2);
    if (nextOffset <= offset || nextOffset > view.byteLength) break;
    offset = nextOffset;
  }

  if (!format || dataOffset < 0) {
    throw new Error("VAD worker WAV file is missing its format or audio data chunk.");
  }
  const { audioFormat, channelCount, sampleRate, blockAlign, bitsPerSample } = format;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channelCount <= 0 || blockAlign <= 0) {
    throw new Error("VAD worker WAV file has invalid audio format metadata.");
  }

  const isPcm16 = audioFormat === 1 && bitsPerSample === 16;
  const isFloat32 = audioFormat === 3 && bitsPerSample === 32;
  if (!isPcm16 && !isFloat32) {
    throw new Error(
      `VAD worker supports 16-bit PCM and 32-bit float WAV audio; received format ${audioFormat}/${bitsPerSample}-bit.`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  if (blockAlign < channelCount * bytesPerSample) {
    throw new Error("VAD worker WAV file has an invalid block alignment.");
  }
  const frameCount = Math.floor(dataSize / blockAlign);
  const pcm = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * blockAlign;
    let mixedSample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      mixedSample += isPcm16
        ? view.getInt16(sampleOffset, true) / 32768
        : view.getFloat32(sampleOffset, true);
    }
    pcm[frame] = mixedSample / channelCount;
  }
  return { pcm, sampleRate };
}

function readFourCc(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
