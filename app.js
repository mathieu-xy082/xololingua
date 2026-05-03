const MAX_DURATION_SECONDS = 2.5 * 60 * 60;
const SEGMENT_SECONDS = 12;
const LOCAL_SERVICE_URL = "http://127.0.0.1:8765";

const languages = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ur", name: "Urdu" },
  { code: "id", name: "Indonesian" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "sw", name: "Swahili" },
  { code: "mr", name: "Marathi" },
  { code: "te", name: "Telugu" },
  { code: "tr", name: "Turkish" },
  { code: "ta", name: "Tamil" },
  { code: "it", name: "Italian" },
  { code: "uk", name: "Ukrainian" }
];

const supportedLanguagePairs = new Set([
  "en:fr",
  "fr:en",
  "fr:ru",
  "ru:fr",
  "fr:uk",
  "uk:fr",
  "fr:zh",
  "zh:fr",
  "fr:de",
  "de:fr",
  "fr:es",
  "es:fr",
  "fr:hi",
  "hi:fr",
  "fr:ja",
  "ja:fr"
]);

const state = {
  videoFile: null,
  videoUrl: "",
  duration: 0,
  metadataReady: false,
  sourceLanguage: null,
  targetLanguage: "",
  extractedAudio: null,
  segments: [],
  srtUrl: "",
  subtitleJobId: "",
  subtitleCancelRequested: false,
  subtitleNotice: "",
  busyStep: ""
};

const els = {
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#fileInput"),
  browseButton: document.querySelector("#browseButton"),
  videoCard: document.querySelector("#videoCard"),
  videoPreview: document.querySelector("#videoPreview"),
  videoName: document.querySelector("#videoName"),
  videoDetails: document.querySelector("#videoDetails"),
  identifyButton: document.querySelector("#identifyButton"),
  languageStatus: document.querySelector("#languageStatus"),
  sourceLanguageOutput: document.querySelector("#sourceLanguageOutput"),
  targetLanguageSelect: document.querySelector("#targetLanguageSelect"),
  targetStatus: document.querySelector("#targetStatus"),
  segmentButton: document.querySelector("#segmentButton"),
  segmentationStatus: document.querySelector("#segmentationStatus"),
  segmentationProgressText: document.querySelector("#segmentationProgressText"),
  segmentationProgressBar: document.querySelector("#segmentationProgressBar"),
  segmentReview: document.querySelector("#segmentReview"),
  segmentCountSummary: document.querySelector("#segmentCountSummary"),
  segmentSpeechSummary: document.querySelector("#segmentSpeechSummary"),
  segmentAverageSummary: document.querySelector("#segmentAverageSummary"),
  toggleSegmentsButton: document.querySelector("#toggleSegmentsButton"),
  segmentDetails: document.querySelector("#segmentDetails"),
  segmentTableBody: document.querySelector("#segmentTableBody"),
  generateButton: document.querySelector("#generateButton"),
  cancelGenerateButton: document.querySelector("#cancelGenerateButton"),
  subtitleStatus: document.querySelector("#subtitleStatus"),
  subtitleProgressText: document.querySelector("#subtitleProgressText"),
  subtitleProgressBar: document.querySelector("#subtitleProgressBar"),
  downloadLink: document.querySelector("#downloadLink"),
  installButton: document.querySelector("#installButton"),
  serviceWhisperBackend: document.querySelector("#serviceWhisperBackend"),
  serviceWhisperModel: document.querySelector("#serviceWhisperModel"),
  serviceWhisperDevice: document.querySelector("#serviceWhisperDevice")
};

let deferredInstallPrompt = null;

populateLanguages();
bindEvents();
bindInstallPrompt();
registerServiceWorker();
render();
fetchServiceStatus();

function populateLanguages() {
  els.targetLanguageSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select target language";
  els.targetLanguageSelect.append(placeholder);

  languages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.name;
    els.targetLanguageSelect.append(option);
  });
}

async function fetchServiceStatus() {
  try {
    const response = await fetch(`${LOCAL_SERVICE_URL}/api/health`);
    if (!response.ok) return;
    const health = await response.json();
    const backend = health.whisperBackend || "whisper-cli";
    const model = health.whisperModel || "?";
    const device = health.whisperDevice || "?";
    const cudaCount = health.whisperCudaDevices || 0;
    const fallbackReason = health.whisperFallbackReason || "";
    const requestedDevice = health.whisperRequestedDevice || "auto";
    const deviceLabel = device === "cuda"
      ? `GPU (${cudaCount > 1 ? cudaCount + "×" : ""}CUDA)`
      : requestedDevice !== "cpu" && fallbackReason
        ? "CPU fallback"
        : "CPU";
    els.serviceWhisperBackend.textContent = backend;
    els.serviceWhisperModel.textContent = model;
    els.serviceWhisperDevice.textContent = deviceLabel;
    els.serviceWhisperDevice.title = fallbackReason || (
      health.whisperCpuFallbackAvailable === false
        ? `CPU fallback unavailable: ${health.whisperCpuFallbackReason || "unknown"}`
        : ""
    );
  } catch {
    els.serviceWhisperBackend.textContent = "unavailable";
    els.serviceWhisperModel.textContent = "—";
    els.serviceWhisperDevice.textContent = "—";
  }
}

function bindEvents() {
  els.browseButton.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const [file] = els.fileInput.files;
    if (file) loadVideoFile(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragging");
    });
  });

  els.dropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) loadVideoFile(file);
  });

  els.videoPreview.addEventListener("loadedmetadata", () => {
    state.duration = els.videoPreview.duration;
    validateDuration();
    render();
  });

  els.identifyButton.addEventListener("click", identifyLanguage);
  els.targetLanguageSelect.addEventListener("change", () => {
    state.targetLanguage = els.targetLanguageSelect.value;
    resetSegmentation();
    render();
  });
  els.segmentButton.addEventListener("click", segmentAudio);
  els.toggleSegmentsButton.addEventListener("click", toggleSegmentDetails);
  els.generateButton.addEventListener("click", generateSubtitles);
  els.cancelGenerateButton.addEventListener("click", cancelSubtitleGeneration);
}

function loadVideoFile(file) {
  resetOutput();

  if (!isMp4(file)) {
    els.languageStatus.textContent = "Only MP4 video files are supported.";
    render();
    return;
  }

  state.videoFile = file;
  state.videoUrl = URL.createObjectURL(file);
  state.metadataReady = false;
  els.videoPreview.src = state.videoUrl;
  els.videoCard.hidden = false;
  els.languageStatus.textContent = "Video loaded. Metadata is being inspected.";
  render();
}

function validateDuration() {
  if (!Number.isFinite(state.duration) || state.duration <= 0) {
    els.languageStatus.textContent = "The video duration could not be read.";
    state.videoFile = null;
    state.metadataReady = false;
    return;
  }

  if (state.duration > MAX_DURATION_SECONDS) {
    els.languageStatus.textContent = "This video exceeds the 2 h 30 min limit.";
    state.videoFile = null;
    state.metadataReady = false;
    return;
  }

  state.metadataReady = true;
  els.languageStatus.textContent = "Ready to identify the main language.";
}

async function identifyLanguage() {
  if (!state.videoFile) return;

  state.busyStep = "language";
  els.languageStatus.textContent = "Identifying main language...";
  state.sourceLanguage = null;
  state.targetLanguage = "";
  resetSegmentation();
  render();

  const detected = await identifyLanguageAdapter(state.videoFile);
  state.sourceLanguage = detected;
  els.languageStatus.textContent = "Main language identified.";
  state.busyStep = "";
  render();
}

async function segmentAudio() {
  if (!canSegment()) return;

  state.busyStep = "segmentation";
  resetSubtitle();
  state.extractedAudio = null;
  state.segments = [];
  els.segmentationStatus.textContent = "Extracting audio from MP4...";
  setProgress("segmentation", 0);
  render();

  try {
    state.extractedAudio = await extractAudioAdapter(state.videoFile, (progress) => {
      setProgress("segmentation", progress);
    });
  } catch (extractionError) {
    els.segmentationStatus.textContent = `${extractionError.message} Falling back to prototype segmentation.`;
    const segments = await segmentAudioAdapter(state.duration, (progress) => {
      const scaledProgress = 35 + Math.round(progress * 0.65);
      setProgress("segmentation", scaledProgress);
    });
    finishSegmentation(segments);
    return;
  }

  els.segmentationStatus.textContent = `Audio extracted: ${formatBytes(state.extractedAudio.audioSizeBytes)} WAV. Segmenting speech audio...`;
  try {
    const serviceSegments = await serviceSegmentAudioAdapter(state.extractedAudio.audioId, (progress) => {
      const scaledProgress = 35 + Math.round(progress * 0.65);
      setProgress("segmentation", scaledProgress);
    });
    finishSegmentation(serviceSegments);
  } catch (segmentationError) {
    els.segmentationStatus.textContent = `${segmentationError.message} Falling back to prototype segmentation.`;
    const segments = await segmentAudioAdapter(state.duration, (progress) => {
      const scaledProgress = 35 + Math.round(progress * 0.65);
      setProgress("segmentation", scaledProgress);
    });
    finishSegmentation(segments);
  }
}

async function extractAudioAdapter(file, onProgress) {
  onProgress(5);

  const health = await fetch(`${LOCAL_SERVICE_URL}/api/health`);
  if (!health.ok) {
    throw new Error("Local audio service is not available.");
  }

  const formData = new FormData();
  formData.append("video", file, file.name);
  onProgress(15);

  const response = await fetch(`${LOCAL_SERVICE_URL}/api/extract-audio`, {
    method: "POST",
    body: formData
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Audio extraction failed.");
  }

  onProgress(35);
  return payload;
}

async function serviceSegmentAudioAdapter(audioId, onProgress) {
  onProgress(10);

  const response = await fetch(`${LOCAL_SERVICE_URL}/api/segment-audio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ audioId })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Audio segmentation failed.");
  }

  onProgress(100);
  return payload.segments;
}

async function generateSubtitles() {
  if (!canGenerate()) return;
  state.busyStep = "subtitle";
  state.subtitleJobId = "";
  state.subtitleCancelRequested = false;
  state.subtitleNotice = "";
  els.subtitleStatus.textContent = "Starting subtitle generation job...";
  setProgress("subtitle", 0);
  render();

  try {
    const translatedSegments = await runSubtitleJobAdapter(state.extractedAudio, state.sourceLanguage, state.targetLanguage, state.segments, (job) => {
      els.subtitleStatus.textContent = job.message || job.stage;
      setProgress("subtitle", Math.min(90, job.progress || 0));
    }, (job) => {
      state.subtitleJobId = job.jobId;
      render();
    });
    state.segments = translatedSegments;
    renderSegmentReview();
    els.subtitleStatus.textContent = "Preparing translated SRT...";

    const srt = await generateSrtAdapter(state.segments, state.targetLanguage, (progress) => {
      const scaledProgress = 90 + Math.round(progress * 0.1);
      setProgress("subtitle", scaledProgress);
    });
    const fileName = makeSubtitleFileName(state.videoFile.name, state.targetLanguage);
    const blob = new Blob([srt], { type: "application/x-subrip;charset=utf-8" });

    if (state.srtUrl) URL.revokeObjectURL(state.srtUrl);
    state.srtUrl = URL.createObjectURL(blob);

    els.downloadLink.href = state.srtUrl;
    els.downloadLink.download = fileName;
    els.downloadLink.textContent = `Download ${fileName}`;
    els.downloadLink.hidden = false;
    els.subtitleStatus.textContent = "Subtitle file ready.";
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setProgress("subtitle", 100);
    render();
  } catch (error) {
    state.subtitleNotice = error.message;
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setProgress("subtitle", 0);
    render();
  }
}

async function cancelSubtitleGeneration() {
  if (state.busyStep !== "subtitle" || !state.subtitleJobId || state.subtitleCancelRequested) return;

  const jobId = state.subtitleJobId;
  state.subtitleCancelRequested = true;
  els.subtitleStatus.textContent = "Cancelling subtitle generation...";
  render();

  try {
    const job = await cancelSubtitleJobAdapter(jobId);
    state.subtitleNotice = job.message || "Subtitle generation cancelled.";
  } catch (error) {
    state.subtitleNotice = error.message;
  } finally {
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setProgress("subtitle", 0);
    render();
  }
}

async function runSubtitleJobAdapter(extractedAudio, sourceLanguage, targetLanguageCode, segments, onProgress, onJobCreated) {
  if (!extractedAudio) {
    throw new Error("Audio must be extracted before subtitle generation.");
  }

  const response = await fetch(`${LOCAL_SERVICE_URL}/api/subtitle-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audioId: extractedAudio.audioId,
      sourceLanguage: sourceLanguage.code,
      targetLanguage: targetLanguageCode,
      segments
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Subtitle generation job could not start.");
  }

  onJobCreated(payload);
  return pollSubtitleJob(payload.jobId, onProgress);
}

async function cancelSubtitleJobAdapter(jobId) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/api/subtitle-jobs/${jobId}/cancel`, {
    method: "POST"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Subtitle generation job could not be cancelled.");
  }

  return payload;
}

async function pollSubtitleJob(jobId, onProgress) {
  while (true) {
    await delay(1200);
    const response = await fetch(`${LOCAL_SERVICE_URL}/api/subtitle-jobs/${jobId}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Subtitle generation job could not be read.");
    }

    onProgress(payload);

    if (payload.status === "succeeded") {
      return payload.segments;
    }
    if (payload.status === "failed") {
      throw new Error(payload.error || payload.message || "Subtitle generation failed.");
    }
    if (payload.status === "cancelled") {
      throw new Error(payload.message || "Subtitle generation cancelled.");
    }
  }
}

async function identifyLanguageAdapter(file) {
  await delay(900);

  const lowerName = file.name.toLowerCase();
  const match = languages.find((language) => lowerName.includes(language.name.toLowerCase()) || lowerName.includes(`.${language.code}.`));

  return match || languages.find((language) => language.code === navigator.language.slice(0, 2)) || languages[0];
}

async function segmentAudioAdapter(duration, onProgress) {
  const segmentCount = Math.max(1, Math.ceil(duration / SEGMENT_SECONDS));
  const segments = [];

  for (let index = 0; index < segmentCount; index += 1) {
    await delay(45);
    const start = index * SEGMENT_SECONDS;
    const end = Math.min(duration, start + SEGMENT_SECONDS);
    segments.push({
      index: index + 1,
      start,
      end,
      text: `Speech segment ${index + 1}`
    });
    onProgress(Math.round(((index + 1) / segmentCount) * 100));
  }

  return segments;
}

function finishSegmentation(segments) {
  state.segments = segments;
  const extractionDetail = state.extractedAudio
    ? ` Audio file: ${state.extractedAudio.audioFileName}.`
    : " Prototype-only segmentation cannot generate subtitles until audio extraction succeeds.";
  els.segmentationStatus.textContent = `${segments.length} speech segments prepared.${extractionDetail}`;
  state.busyStep = "";
  setProgress("segmentation", 100);
  render();
}

async function generateSrtAdapter(segments, targetLanguageCode, onProgress) {
  const blocks = [];

  for (const segment of segments) {
    await delay(35);
    blocks.push([
      String(segment.index),
      `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}`,
      segment.translatedText || segment.text || ""
    ].join("\n"));
    onProgress(Math.round((segment.index / segments.length) * 100));
  }

  return `${blocks.join("\n\n")}\n`;
}

function render() {
  const hasValidVideo = Boolean(state.videoFile && state.metadataReady);
  const sourceLanguage = state.sourceLanguage;
  const targetLanguage = getLanguage(state.targetLanguage);

  els.identifyButton.disabled = !hasValidVideo || state.busyStep === "language";
  els.videoName.textContent = state.videoFile ? state.videoFile.name : "No video selected";
  els.videoDetails.textContent = state.videoFile
    ? `${formatBytes(state.videoFile.size)} - ${formatDuration(state.duration)}`
    : "";

  els.sourceLanguageOutput.textContent = sourceLanguage
    ? `Source language: ${sourceLanguage.name}`
    : "Source language: unknown";

  els.targetLanguageSelect.disabled = !sourceLanguage;
  els.targetLanguageSelect.value = state.targetLanguage;

  [...els.targetLanguageSelect.options].forEach((option) => {
    option.disabled = Boolean(
      sourceLanguage &&
      option.value &&
      (option.value === sourceLanguage.code || !isSupportedPair(sourceLanguage.code, option.value))
    );
  });

  if (!sourceLanguage) {
    els.targetStatus.textContent = "Identify the video language first.";
  } else if (!targetLanguage) {
    els.targetStatus.textContent = "Select one of the first supported target languages.";
  } else if (targetLanguage.code === sourceLanguage.code) {
    els.targetStatus.textContent = "Target language must differ from source.";
  } else if (!isSupportedPair(sourceLanguage.code, targetLanguage.code)) {
    els.targetStatus.textContent = "This language couple is not in the first supported scope.";
  } else {
    els.targetStatus.textContent = `Target selected: ${targetLanguage.name}.`;
  }

  els.segmentButton.disabled = !canSegment() || state.busyStep === "segmentation";
  els.generateButton.disabled = !canGenerate() || state.busyStep === "subtitle";
  els.cancelGenerateButton.hidden = state.busyStep !== "subtitle";
  els.cancelGenerateButton.disabled = state.subtitleCancelRequested || !state.subtitleJobId;
  renderSegmentReview();
  renderSubtitleStatus();
}

function canSegment() {
  return Boolean(
    state.videoFile &&
    state.metadataReady &&
    state.sourceLanguage &&
    state.targetLanguage &&
    state.targetLanguage !== state.sourceLanguage.code &&
    isSupportedPair(state.sourceLanguage.code, state.targetLanguage)
  );
}

function canGenerate() {
  return canSegment() && state.segments.length > 0 && !!state.extractedAudio;
}

function resetOutput() {
  cancelActiveSubtitleJobSilently();
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoFile = null;
  state.videoUrl = "";
  state.duration = 0;
  state.metadataReady = false;
  state.sourceLanguage = null;
  state.targetLanguage = "";
  state.extractedAudio = null;
  state.busyStep = "";
  els.videoPreview.removeAttribute("src");
  els.videoPreview.load();
  els.videoCard.hidden = true;
  els.targetLanguageSelect.value = "";
  resetSegmentation();
}

function resetSegmentation() {
  state.segments = [];
  els.segmentDetails.hidden = true;
  els.toggleSegmentsButton.setAttribute("aria-expanded", "false");
  els.toggleSegmentsButton.textContent = "Show details";
  els.segmentationStatus.textContent = canSegment()
    ? "Ready to segment speech audio."
    : "Select a different target language.";
  setProgress("segmentation", 0);
  resetSubtitle();
}

function resetSubtitle() {
  const cancelledActiveJob = cancelActiveSubtitleJobSilently();
  if (cancelledActiveJob) state.busyStep = "";
  if (state.srtUrl) URL.revokeObjectURL(state.srtUrl);
  state.srtUrl = "";
  state.subtitleJobId = "";
  state.subtitleCancelRequested = false;
  state.subtitleNotice = "";
  els.subtitleStatus.textContent = "Run segmentation first.";
  els.downloadLink.hidden = true;
  els.downloadLink.removeAttribute("href");
  els.downloadLink.removeAttribute("download");
  setProgress("subtitle", 0);
}

function cancelActiveSubtitleJobSilently() {
  if (state.busyStep !== "subtitle" || !state.subtitleJobId || state.subtitleCancelRequested) return false;

  state.subtitleCancelRequested = true;
  cancelSubtitleJobAdapter(state.subtitleJobId).catch(() => {});
  return true;
}

function renderSubtitleStatus() {
  if (state.busyStep === "subtitle" || state.srtUrl) return;

  if (state.subtitleNotice) {
    els.subtitleStatus.textContent = state.subtitleNotice;
    return;
  }

  if (canGenerate()) {
    els.subtitleStatus.textContent = "Ready to transcribe and translate.";
    return;
  }

  if (canSegment() && state.segments.length > 0 && !state.extractedAudio) {
    els.subtitleStatus.textContent = "Rerun segmentation with the local service available.";
    return;
  }

  els.subtitleStatus.textContent = "Run segmentation first.";
}

function setProgress(kind, value) {
  const clamped = Math.max(0, Math.min(100, value));
  const text = kind === "segmentation" ? els.segmentationProgressText : els.subtitleProgressText;
  const bar = kind === "segmentation" ? els.segmentationProgressBar : els.subtitleProgressBar;
  text.textContent = `${clamped}%`;
  bar.style.width = `${clamped}%`;
}

function renderSegmentReview() {
  els.segmentReview.hidden = state.segments.length === 0;

  if (state.segments.length === 0) {
    els.segmentTableBody.replaceChildren();
    els.segmentCountSummary.textContent = "0";
    els.segmentSpeechSummary.textContent = "0 s";
    els.segmentAverageSummary.textContent = "0 s";
    return;
  }

  const totalSpeechSeconds = state.segments.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
  const averageSeconds = totalSpeechSeconds / state.segments.length;

  els.segmentCountSummary.textContent = String(state.segments.length);
  els.segmentSpeechSummary.textContent = formatDuration(totalSpeechSeconds);
  els.segmentAverageSummary.textContent = formatDuration(averageSeconds);
  els.segmentTableBody.replaceChildren(...state.segments.map(segmentRow));
}

function segmentRow(segment) {
  const row = document.createElement("tr");
  const numberCell = document.createElement("td");
  const startCell = document.createElement("td");
  const durationCell = document.createElement("td");

  numberCell.textContent = String(segment.index);
  startCell.textContent = formatSrtTime(segment.start).replace(",", ".");
  durationCell.textContent = formatDuration(Math.max(0, segment.end - segment.start));

  row.append(numberCell, startCell, durationCell);
  return row;
}

function toggleSegmentDetails() {
  const shouldShow = els.segmentDetails.hidden;
  els.segmentDetails.hidden = !shouldShow;
  els.toggleSegmentsButton.setAttribute("aria-expanded", String(shouldShow));
  els.toggleSegmentsButton.textContent = shouldShow ? "Hide details" : "Show details";
}

function isMp4(file) {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

function getLanguage(code) {
  return languages.find((language) => language.code === code) || null;
}

function isSupportedPair(sourceCode, targetCode) {
  return supportedLanguagePairs.has(`${sourceCode}:${targetCode}`);
}

function makeSubtitleFileName(videoName, languageCode) {
  const base = videoName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 20) || "subtitles";
  return `${base}.${languageCode}.srt`;
}

function formatSrtTime(seconds) {
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0")
  ].join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "duration pending";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) return `${hours} h ${minutes} min ${remainingSeconds} s`;
  if (minutes > 0) return `${minutes} min ${remainingSeconds} s`;
  return `${remainingSeconds} s`;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bindInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js");
    });
  }
}
