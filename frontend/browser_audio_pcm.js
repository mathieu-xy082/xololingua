export async function prepareBrowserPcmAudio(
  audio,
  environment = globalThis,
  { required = false } = {},
) {
  if (audio?.pcm instanceof Float32Array) return audio;

  const AudioContextCtor = environment?.AudioContext || environment?.webkitAudioContext;
  const canDecode = audio?.audioBlob
    && typeof audio.audioBlob.arrayBuffer === "function"
    && typeof AudioContextCtor === "function";
  if (!canDecode) {
    if (!required) return audio;
    throw new Error("Browser language detection requires a decodable audio Blob or Float32 PCM audio.");
  }

  const audioContext = new AudioContextCtor({
    sampleRate: audio.sampleRateHz || audio.sampleRate || 16_000,
  });
  try {
    const decoded = await audioContext.decodeAudioData(await audio.audioBlob.arrayBuffer());
    const pcm = new Float32Array(decoded.getChannelData(0));
    return {
      ...audio,
      pcm,
      sampleRate: decoded.sampleRate,
      sampleRateHz: decoded.sampleRate,
      channelCount: decoded.numberOfChannels,
      durationSeconds: audio.durationSeconds ?? decoded.duration,
    };
  } finally {
    if (typeof audioContext.close === "function") await audioContext.close();
  }
}
