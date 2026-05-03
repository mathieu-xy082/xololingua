const MAX_DURATION_SECONDS = 2.5 * 60 * 60;
const SEGMENT_SECONDS = 12;

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

const state = {
  videoFile: null,
  videoUrl: "",
  duration: 0,
  metadataReady: false,
  sourceLanguage: null,
  targetLanguage: "",
  segments: [],
  srtUrl: "",
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
  generateButton: document.querySelector("#generateButton"),
  subtitleStatus: document.querySelector("#subtitleStatus"),
  subtitleProgressText: document.querySelector("#subtitleProgressText"),
  subtitleProgressBar: document.querySelector("#subtitleProgressBar"),
  downloadLink: document.querySelector("#downloadLink"),
  installButton: document.querySelector("#installButton")
};

let deferredInstallPrompt = null;

populateLanguages();
bindEvents();
bindInstallPrompt();
registerServiceWorker();
render();

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
  els.generateButton.addEventListener("click", generateSubtitles);
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
  state.segments = [];
  els.segmentationStatus.textContent = "Segmenting speech audio...";
  setProgress("segmentation", 0);
  render();

  const segments = await segmentAudioAdapter(state.duration, (progress) => {
    setProgress("segmentation", progress);
  });

  state.segments = segments;
  els.segmentationStatus.textContent = `${segments.length} speech segments prepared.`;
  state.busyStep = "";
  setProgress("segmentation", 100);
  render();
}

async function generateSubtitles() {
  if (!canGenerate()) return;

  state.busyStep = "subtitle";
  els.subtitleStatus.textContent = "Translating segments and preparing SRT...";
  setProgress("subtitle", 0);
  render();

  const srt = await generateSrtAdapter(state.segments, state.targetLanguage, (progress) => {
    setProgress("subtitle", progress);
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
  setProgress("subtitle", 100);
  render();
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

async function generateSrtAdapter(segments, targetLanguageCode, onProgress) {
  const target = getLanguage(targetLanguageCode);
  const blocks = [];

  for (const segment of segments) {
    await delay(35);
    blocks.push([
      String(segment.index),
      `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}`,
      `[${target.name}] ${segment.text}`
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
    option.disabled = Boolean(sourceLanguage && option.value === sourceLanguage.code);
  });

  if (!sourceLanguage) {
    els.targetStatus.textContent = "Identify the video language first.";
  } else if (!targetLanguage) {
    els.targetStatus.textContent = "Select a target language.";
  } else if (targetLanguage.code === sourceLanguage.code) {
    els.targetStatus.textContent = "Target language must differ from source.";
  } else {
    els.targetStatus.textContent = `Target selected: ${targetLanguage.name}.`;
  }

  els.segmentButton.disabled = !canSegment() || state.busyStep === "segmentation";
  els.generateButton.disabled = !canGenerate() || state.busyStep === "subtitle";
}

function canSegment() {
  return Boolean(
    state.videoFile &&
    state.metadataReady &&
    state.sourceLanguage &&
    state.targetLanguage &&
    state.targetLanguage !== state.sourceLanguage.code
  );
}

function canGenerate() {
  return canSegment() && state.segments.length > 0;
}

function resetOutput() {
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoFile = null;
  state.videoUrl = "";
  state.duration = 0;
  state.metadataReady = false;
  state.sourceLanguage = null;
  state.targetLanguage = "";
  state.busyStep = "";
  els.videoPreview.removeAttribute("src");
  els.videoPreview.load();
  els.videoCard.hidden = true;
  els.targetLanguageSelect.value = "";
  resetSegmentation();
}

function resetSegmentation() {
  state.segments = [];
  els.segmentationStatus.textContent = canSegment()
    ? "Ready to segment speech audio."
    : "Select a different target language.";
  setProgress("segmentation", 0);
  resetSubtitle();
}

function resetSubtitle() {
  if (state.srtUrl) URL.revokeObjectURL(state.srtUrl);
  state.srtUrl = "";
  els.subtitleStatus.textContent = "Run segmentation first.";
  els.downloadLink.hidden = true;
  els.downloadLink.removeAttribute("href");
  els.downloadLink.removeAttribute("download");
  setProgress("subtitle", 0);
}

function setProgress(kind, value) {
  const clamped = Math.max(0, Math.min(100, value));
  const text = kind === "segmentation" ? els.segmentationProgressText : els.subtitleProgressText;
  const bar = kind === "segmentation" ? els.segmentationProgressBar : els.subtitleProgressBar;
  text.textContent = `${clamped}%`;
  bar.style.width = `${clamped}%`;
}

function isMp4(file) {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

function getLanguage(code) {
  return languages.find((language) => language.code === code) || null;
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
