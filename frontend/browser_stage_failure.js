const STAGE_LABELS = {
  audioExtraction: "Audio extraction",
  vad: "Audio segmentation",
  transcription: "Transcription",
  translation: "Translation",
};

export function browserStageFailure(stageName, error) {
  if (error?.cancelled) return error;
  const reason = String(error?.message || error || "").trim()
    .replace(/\s*Use the Python fallback[^.]*\./gi, "")
    .replace(/\s*Use the Python fallback[^.]*$/gi, "")
    .replace(/\s*using Python backend fallback\./gi, ".")
    .trim().slice(0, 300);
  const guidance = browserFailureGuidance(stageName, reason);
  const label = STAGE_LABELS[stageName] || "Processing";
  const message = `${label} could not finish in this browser. ${reason ? `Reason: ${reason} ` : ""}${guidance} Server processing is unavailable on the public site.`;
  const failure = new Error(message, { cause: error });
  failure.stage = stageName;
  return failure;
}

function browserFailureGuidance(stageName, reason) {
  const text = reason.toLowerCase();
  if (stageName === "audioExtraction" && /input files up to|received .*browser limit/.test(text)) {
    return "Choose or compress an MP4 to 400 MiB or less, then try again.";
  }
  if (/out of memory|memory|allocation|allocating|oom|heap/.test(text)) {
    return "Close other browser tabs and try a shorter or smaller video.";
  }
  if (/download|network|fetch|connection|offline|http 40[34]/.test(text)) {
    return "Check your internet connection, reload the page, and try again.";
  }
  if (stageName === "translation" && /model|language pair|route|unsupported/.test(text)) {
    return "Choose another target language or try again after reloading the page.";
  }
  if (/not configured|not loaded|not implemented|required for browser/.test(text)) {
    return "Reload the page to restore browser processing assets, or try an up-to-date Chrome or Chromium browser.";
  }
  if (/webgpu|gpu|worker|wasm|unavailable/.test(text)) {
    return "Try an up-to-date Chrome or Chromium browser, update your graphics driver, and reload the page.";
  }
  if (stageName === "audioExtraction") {
    return "Try a smaller MP4 or re-encode it with a common video and audio codec, then retry.";
  }
  if (stageName === "vad") {
    return "Reload the page and try a shorter video in an up-to-date browser.";
  }
  return "Reload the page and try a shorter video in an up-to-date browser.";
}
