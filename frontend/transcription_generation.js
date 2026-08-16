const MIN_WHISPER_NEW_TOKENS = 16;
const MAX_WHISPER_NEW_TOKENS = 180;
const WHISPER_NEW_TOKENS_PER_AUDIO_SECOND = 6;

export function calculateWhisperTokenBudget(audioSeconds) {
  const seconds = Math.max(0, Number(audioSeconds) || 0);
  return Math.min(
    MAX_WHISPER_NEW_TOKENS,
    Math.max(MIN_WHISPER_NEW_TOKENS, Math.ceil(seconds * WHISPER_NEW_TOKENS_PER_AUDIO_SECOND)),
  );
}

export {
  MAX_WHISPER_NEW_TOKENS,
  MIN_WHISPER_NEW_TOKENS,
  WHISPER_NEW_TOKENS_PER_AUDIO_SECOND,
};
