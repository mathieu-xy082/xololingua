// Browser stages are eligible for up to one hour when inputs fit the byte
// budgets. Two 400 MiB MP4 representations plus three one-hour WAV buffers
// total about 1.1 GiB before ffmpeg.wasm's own heap is counted.
export const BROWSER_MAX_MEDIA_DURATION_SECONDS = 60 * 60;
export const BROWSER_MAX_VIDEO_BYTES = 400 * 1024 * 1024;
export const BROWSER_MAX_AUDIO_BYTES = 250 * 1024 * 1024;

// 9,000 segments is the one-hour equivalent of 0.4 s VAD segments, avoiding
// a count guard that routinely cuts off speech-rich videos before one hour.
export const BROWSER_MAX_SEGMENTS = 9_000;
