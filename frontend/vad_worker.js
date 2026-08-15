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
  pcmBuffer,
  sampleRate,
  modelURL,
  ortWasmBasePath,
  vadOptions = {},
  chunkSeconds = DEFAULT_CHUNK_SECONDS,
} = {}) {
  if (!(pcmBuffer instanceof ArrayBuffer)) {
    throw new Error("VAD worker requires a transferred PCM ArrayBuffer.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("VAD worker requires a positive sample rate.");
  }
  if (typeof self.vad?.NonRealTimeVAD?.new !== "function") {
    throw new Error("vad-web failed to load in the VAD worker.");
  }

  const pcm = new Float32Array(pcmBuffer);
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

  return { segments, rawSegmentCount: segments.length };
}
