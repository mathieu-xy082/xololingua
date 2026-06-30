export function detectClientAudioExtractionCapabilities(environment = globalThis) {
  const webCodecs = typeof environment.VideoDecoder === "function"
    && typeof environment.AudioDecoder === "function"
    && typeof environment.AudioContext === "function";
  const ffmpegWasm = typeof environment.createFFmpeg === "function"
    || Boolean(environment.ffmpegWasm);

  return {
    webCodecs,
    ffmpegWasm,
    strategy: webCodecs ? "webcodecs" : ffmpegWasm ? "ffmpeg.wasm" : "unavailable",
  };
}

export function createClientAudioExtractor({
  environment = globalThis,
  ffmpegWasmExtractor,
} = {}) {
  return {
    capabilities: detectClientAudioExtractionCapabilities(environment),

    async extractAudio(file, onProgress = () => {}) {
      const capabilities = detectClientAudioExtractionCapabilities(environment);

      if (capabilities.webCodecs) {
        throw new Error("WebCodecs audio extraction is detected but not implemented yet.");
      }

      if (typeof ffmpegWasmExtractor === "function") {
        onProgress(0);
        const extracted = await ffmpegWasmExtractor(file, onProgress);
        return {
          ...extracted,
          strategy: "ffmpeg.wasm",
          fallbackUsed: true,
        };
      }

      throw new Error("Browser audio extraction requires WebCodecs or a configured ffmpeg.wasm fallback.");
    },
  };
}
