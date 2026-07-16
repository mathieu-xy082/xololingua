import { createBackendClient } from "./frontend/backend_client.js";
import { createAppClientAdapters, createAppHybridPipelineRouter } from "./frontend/app_hybrid_router_wiring.js";
import { createClientAudioExtractor } from "./frontend/client_audio_extractor.js";
import { collectClientPipelineCapabilities } from "./frontend/client_pipeline_capabilities.js";
import { formatSrt, formatSrtTime } from "./frontend/client_srt_formatter.js";
import { createClientVadSegmenter } from "./frontend/client_vad_segmenter.js";
import { createAppFfmpegWasmAudioExtractor } from "./frontend/ffmpeg_wasm_runtime.js";
import { formatPipelineStageRuntime, formatPipelineStageSummary } from "./frontend/pipeline_stage_status.js";
import { createVadWebRuntimeSegmenter } from "./frontend/vad_web_runtime.js";

const MAX_DURATION_SECONDS = 2.5 * 60 * 60;
const SEGMENT_SECONDS = 12;
const LOCAL_SERVICE_URL = "http://127.0.0.1:8765";
const APP_ASSET_VERSION = "2026-07-15-1";
const backendClient = createBackendClient({ baseUrl: LOCAL_SERVICE_URL });
const clientPipelineCapabilities = collectClientPipelineCapabilities();
const appClientAdapters = createAppClientAdapters({
  clientAudioExtractor: globalThis.XOLOLINGUA_CLIENT_AUDIO_EXTRACTOR || createClientAudioExtractor({
    ffmpegWasmExtractor: createAppFfmpegWasmAudioExtractor(),
  }),
  clientVadSegmenter: globalThis.XOLOLINGUA_CLIENT_VAD_SEGMENTER || createClientVadSegmenter({
    vadWebSegmenter: createVadWebRuntimeSegmenter(),
  }),
});
const hybridPipelineRouter = createAppHybridPipelineRouter({
  backendClient,
  capabilityReport: clientPipelineCapabilities,
  clientAdapters: appClientAdapters,
  srtFormatter: formatSrt,
});

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

const supportedLanguagePairs = new Set();

const state = {
  videoFile: null,
  videoUrl: "",
  duration: 0,
  metadataReady: false,
  sourceLanguage: null,
  targetLanguage: "",
  languageProgress: 0,
  extractedAudio: null,
  segments: [],
  pipelineStageReports: [],
  srtUrl: "",
  subtitleJobId: "",
  subtitleCancelRequested: false,
  subtitleNotice: "",
  subtitleTranscriptionProgress: 0,
  subtitleTranslationProgress: 0,
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
  clearVideoButton: document.querySelector("#clearVideoButton"),
  identifyButton: document.querySelector("#identifyButton"),
  languageStatus: document.querySelector("#languageStatus"),
  languageProgressText: document.querySelector("#languageProgressText"),
  languageProgressBar: document.querySelector("#languageProgressBar"),
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
  subtitleTranscriptionProgressText: document.querySelector("#subtitleTranscriptionProgressText"),
  subtitleTranscriptionProgressBar: document.querySelector("#subtitleTranscriptionProgressBar"),
  subtitleTranslationProgressText: document.querySelector("#subtitleTranslationProgressText"),
  subtitleTranslationProgressBar: document.querySelector("#subtitleTranslationProgressBar"),
  downloadLink: document.querySelector("#downloadLink"),
  installButton: document.querySelector("#installButton"),
  serviceWhisperBackend: document.querySelector("#serviceWhisperBackend"),
  serviceWhisperModel: document.querySelector("#serviceWhisperModel"),
  serviceWhisperDevice: document.querySelector("#serviceWhisperDevice"),
  pwaOfflineScope: document.querySelector("#pwaOfflineScope"),
  pipelineBrowserStages: document.querySelector("#pipelineBrowserStages"),
  pipelineFallbackStages: document.querySelector("#pipelineFallbackStages"),
  pipelineFallbackEndpoints: document.querySelector("#pipelineFallbackEndpoints")
};

let deferredInstallPrompt = null;
let _pairsFetched = false;

populateLanguages();
bindEvents();
bindInstallPrompt();
renderPipelineCapabilitySummary();
registerServiceWorker();
render();
fetchServiceStatus();
fetchTranslationPairs();

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

function renderPipelineCapabilitySummary() {
  const summary = clientPipelineCapabilities.demoSummary;
  els.pwaOfflineScope.textContent = summary.offlineScopeLabel || "Offline assets available; ML stages may still need Python fallback.";
  els.pwaOfflineScope.title = summary.headline;
  els.pipelineBrowserStages.textContent = summary.browserStageLabels.length > 0
    ? summary.browserStageLabels.join(", ")
    : "none";
  els.pipelineFallbackStages.textContent = summary.serverFallbackStageLabels.length > 0
    ? summary.serverFallbackStageLabels.join(", ")
    : "none";
  els.pipelineFallbackEndpoints.replaceChildren(
    ...summary.serverFallbackEndpoints.map((fallback) => {
      const item = document.createElement("li");
      item.textContent = `${fallback.label}: ${fallback.endpoints.join(", ")}`;
      return item;
    }),
  );
}

async function fetchTranslationPairs() {
  if (_pairsFetched) return;
  try {
    const pairs = await backendClient.getTranslationPairs();
    for (const { source, target } of pairs) {
      supportedLanguagePairs.add(`${source}:${target}`);
    }
    _pairsFetched = true;
    render();
  } catch {
    // Service not reachable yet — pairs remain empty, will retry on next health check
  }
}

async function fetchServiceStatus() {
  try {
    const health = await backendClient.getHealth();
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
    fetchTranslationPairs();
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
  els.clearVideoButton.addEventListener("click", () => {
    resetOutput();
    render();
  });
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
  setProgress("language", 0);
  resetSegmentation();
  render();

  try {
    const detected = await identifyLanguageAdapter(
      state.videoFile,
      (progress) => setProgress("language", progress),
      (message) => {
        els.languageStatus.textContent = message;
      },
    );
    state.extractedAudio = null;
    state.sourceLanguage = detected.language;
    els.languageStatus.textContent = "Main language identified.";
    setProgress("language", 100);
  } catch (error) {
    els.languageStatus.textContent = error.message;
    setProgress("language", 0);
  } finally {
    state.busyStep = "";
    render();
  }
}

async function segmentAudio() {
  if (!canSegment()) return;

  state.busyStep = "segmentation";
  resetSubtitle();
  if (!state.extractedAudio) {
    state.extractedAudio = null;
  }
  state.segments = [];
  state.pipelineStageReports = [];
  els.segmentationStatus.textContent = state.extractedAudio
    ? `Audio already extracted: ${formatBytes(state.extractedAudio.audioSizeBytes)} WAV. Segmenting speech audio...`
    : "Extracting audio from MP4...";
  setProgress("segmentation", 0);
  render();

  const stageReports = [];
  if (!state.extractedAudio) {
    try {
      const extraction = await hybridPipelineRouter.runAudioExtraction(state.videoFile, (progress) => {
        setProgress("segmentation", progress);
      });
      stageReports.push({ stage: "audioExtraction", ...extraction });
      state.extractedAudio = { ...extraction.payload, ...extraction.metadata };
      els.segmentationStatus.textContent = `${formatPipelineStageRuntime({ stage: "audioExtraction", ...extraction })}. Segmenting speech audio...`;
    } catch (extractionError) {
      els.segmentationStatus.textContent = `${extractionError.message} Falling back to prototype segmentation.`;
      const segments = await segmentAudioAdapter(state.duration, (progress) => {
        const scaledProgress = 35 + Math.round(progress * 0.65);
        setProgress("segmentation", scaledProgress);
      });
      finishSegmentation(segments, stageReports);
      return;
    }
  }

  els.segmentationStatus.textContent = `Audio extracted: ${formatBytes(state.extractedAudio.audioSizeBytes)} WAV. Segmenting speech audio...`;
  try {
    if (!state.extractedAudio.audioId && state.extractedAudio.audioBlob) {
      els.segmentationStatus.textContent = "Registering browser-extracted audio for Python fallback stages...";
      const registeredAudio = await backendClient.registerAudio(state.extractedAudio, (progress) => {
        const scaledProgress = 35 + Math.round(progress * 0.15);
        setProgress("segmentation", scaledProgress);
      });
      state.extractedAudio = { ...state.extractedAudio, ...registeredAudio };
    }
    const segmentation = await hybridPipelineRouter.runVadSegmentation(state.extractedAudio, (progress) => {
      const scaledProgress = 50 + Math.round(progress * 0.5);
      setProgress("segmentation", scaledProgress);
    });
    stageReports.push({ stage: "vad", ...segmentation });
    finishSegmentation(segmentation.payload.segments, stageReports);
  } catch (segmentationError) {
    els.segmentationStatus.textContent = `${segmentationError.message} Falling back to prototype segmentation.`;
    const segments = await segmentAudioAdapter(state.duration, (progress) => {
      const scaledProgress = 35 + Math.round(progress * 0.65);
      setProgress("segmentation", scaledProgress);
    });
    finishSegmentation(segments, stageReports);
  }
}

async function generateSubtitles() {
  if (!canGenerate()) return;
  state.busyStep = "subtitle";
  state.subtitleJobId = "";
  state.subtitleCancelRequested = false;
  state.subtitleNotice = "";
  els.subtitleStatus.textContent = "Starting subtitle generation job...";
  setSubtitleProgress(0, 0);
  render();

  try {
    const transcription = await hybridPipelineRouter.runTranscription(
      {
        audioId: state.extractedAudio.audioId,
        sourceLanguage: state.sourceLanguage,
        segments: state.segments,
      },
      (job) => {
        els.subtitleStatus.textContent = job.message || job.stage;
        syncSubtitleProgress(job);
      },
    );
    state.segments = transcription.payload.segments;
    renderSegmentReview();
    els.subtitleStatus.textContent = `Subtitle generation: ${formatPipelineStageRuntime({ stage: "transcription", ...transcription })}. Translating subtitles...`;

    const translation = await hybridPipelineRouter.runTranslation(
      {
        extractedAudio: state.extractedAudio,
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        segments: transcription.payload.segments,
        onJobCreated: (job) => {
          state.subtitleJobId = job.jobId;
          render();
        },
      },
      (job) => {
        els.subtitleStatus.textContent = job.message || job.stage;
        syncSubtitleProgress(job);
      },
    );
    state.segments = translation.payload.segments;
    state.pipelineStageReports = [...state.pipelineStageReports, { stage: "transcription", ...transcription }, { stage: "translation", ...translation }];
    renderSegmentReview();
    els.subtitleStatus.textContent = `Subtitle generation: ${formatPipelineStageRuntime({ stage: "translation", ...translation })}. Preparing translated SRT...`;

    const srtFormatting = await hybridPipelineRouter.runSrtFormatting(state.segments, () => {
      setSubtitleProgress(100, 100);
    });
    state.pipelineStageReports = [...state.pipelineStageReports, { stage: "srtFormatting", ...srtFormatting }];
    const srt = srtFormatting.payload.srtText;
    const fileName = makeSubtitleFileName(state.videoFile.name, state.targetLanguage);
    const blob = new Blob([srt], { type: "application/x-subrip;charset=utf-8" });

    if (state.srtUrl) URL.revokeObjectURL(state.srtUrl);
    state.srtUrl = URL.createObjectURL(blob);

    els.downloadLink.href = state.srtUrl;
    els.downloadLink.download = fileName;
    els.downloadLink.textContent = `Download ${fileName}`;
    els.downloadLink.hidden = false;
    els.subtitleStatus.textContent = state.pipelineStageReports.length > 0
      ? `Subtitle file ready. Pipeline: ${formatPipelineStageSummary(state.pipelineStageReports)}.`
      : "Subtitle file ready.";
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setSubtitleProgress(100, 100);
    render();
  } catch (error) {
    state.subtitleNotice = error.message;
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setSubtitleProgress(0, 0);
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
    setSubtitleProgress(0, 0);
    render();
  }
}

async function cancelSubtitleJobAdapter(jobId) {
  return backendClient.cancelSubtitleJob(jobId);
}

async function identifyLanguageAdapter(file, onProgress = () => {}, onStatus = () => {}) {
  try {
    await backendClient.getHealth();
  } catch {
    throw new Error("Local audio service is not available for language detection.");
  }

  const formData = new FormData();
  formData.append("video", file, file.name);
  onProgress(5);
  onStatus("Uploading video for language detection...");

  const payload = await postFormDataJsonWithProgress(
    `${LOCAL_SERVICE_URL}/api/detect-language`,
    formData,
    (uploadProgress) => {
      const mapped = 5 + Math.round(uploadProgress * 0.3);
      onProgress(mapped);
      onStatus("Uploading video for language detection...");
    },
    (progress) => {
      onProgress(progress);
      if (progress < 55) {
        onStatus("Extracting language samples...");
      } else if (progress < 85) {
        onStatus("Detecting language across samples...");
      } else {
        onStatus("Aggregating detection votes...");
      }
    },
  );

  const language = getLanguage(payload.languageCode);
  if (!language) {
    throw new Error(`Detected unsupported language code: ${payload.languageCode || "unknown"}.`);
  }

  return { language };
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

function finishSegmentation(segments, stageReports = []) {
  state.segments = segments;
  state.pipelineStageReports = stageReports;
  const extractionDetail = state.extractedAudio
    ? ` Audio file: ${state.extractedAudio.audioFileName}.`
    : " Prototype-only segmentation cannot generate subtitles until audio extraction succeeds.";
  const runtimeDetail = stageReports.length > 0
    ? ` Pipeline: ${formatPipelineStageSummary(stageReports)}.`
    : "";
  els.segmentationStatus.textContent = `${segments.length} speech segments prepared.${extractionDetail}${runtimeDetail}`;
  state.busyStep = "";
  setProgress("segmentation", 100);
  render();
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
    const pairsLoaded = supportedLanguagePairs.size > 0;
    option.disabled = Boolean(
      sourceLanguage &&
      option.value &&
      (option.value === sourceLanguage.code || (pairsLoaded && !isSupportedPair(sourceLanguage.code, option.value)))
    );
  });

  if (!sourceLanguage) {
    els.targetStatus.textContent = "Identify the video language first.";
  } else if (!targetLanguage) {
    els.targetStatus.textContent = "Select one of the first supported target languages.";
  } else if (targetLanguage.code === sourceLanguage.code) {
    els.targetStatus.textContent = "Target language must differ from source.";
  } else if (supportedLanguagePairs.size > 0 && !isSupportedPair(sourceLanguage.code, targetLanguage.code)) {
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
  const audioId = state.extractedAudio?.audioId || "";
  cancelActiveSubtitleJobSilently();
  releaseExtractedAudioSilently(audioId);
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoFile = null;
  state.videoUrl = "";
  state.duration = 0;
  state.metadataReady = false;
  state.sourceLanguage = null;
  state.targetLanguage = "";
  state.languageProgress = 0;
  state.extractedAudio = null;
  state.pipelineStageReports = [];
  state.busyStep = "";
  els.videoPreview.removeAttribute("src");
  els.videoPreview.load();
  els.videoCard.hidden = true;
  els.fileInput.value = "";
  els.targetLanguageSelect.value = "";
  setProgress("language", 0);
  resetSegmentation();
}

function resetSegmentation() {
  state.segments = [];
  state.pipelineStageReports = [];
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
  state.subtitleTranscriptionProgress = 0;
  state.subtitleTranslationProgress = 0;
  els.subtitleStatus.textContent = "Run segmentation first.";
  els.downloadLink.hidden = true;
  els.downloadLink.removeAttribute("href");
  els.downloadLink.removeAttribute("download");
  setSubtitleProgress(0, 0);
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
  let text = els.segmentationProgressText;
  let bar = els.segmentationProgressBar;
  if (kind === "language") {
    state.languageProgress = clamped;
    text = els.languageProgressText;
    bar = els.languageProgressBar;
  }
  text.textContent = `${clamped}%`;
  bar.style.width = `${clamped}%`;
}

function setSubtitleProgress(transcription, translation) {
  state.subtitleTranscriptionProgress = clampProgress(transcription);
  state.subtitleTranslationProgress = clampProgress(translation);
  els.subtitleTranscriptionProgressText.textContent = `${state.subtitleTranscriptionProgress}%`;
  els.subtitleTranscriptionProgressBar.style.width = `${state.subtitleTranscriptionProgress}%`;
  els.subtitleTranslationProgressText.textContent = `${state.subtitleTranslationProgress}%`;
  els.subtitleTranslationProgressBar.style.width = `${state.subtitleTranslationProgress}%`;
}

function syncSubtitleProgress(job) {
  const rawProgress = clampProgress(job.progress || 0);

  if (job.stage === "transcribing") {
    const transcription = Math.round((rawProgress / 55) * 100);
    setSubtitleProgress(transcription, 0);
    return;
  }

  if (job.stage === "translating") {
    if (typeof job.translationProgress === "number") {
      setSubtitleProgress(100, job.translationProgress);
      return;
    }
    const translation = Math.round(((rawProgress - 55) / 35) * 100);
    setSubtitleProgress(100, translation);
    return;
  }

  if (job.stage === "ready" || job.status === "succeeded") {
    setSubtitleProgress(100, 100);
  }
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function cleanupExtractedAudioAdapter(audioId) {
  if (!audioId) return;

  const response = await fetch(`${LOCAL_SERVICE_URL}/api/release-audio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ audioId })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Audio cleanup failed.");
  }
}

function releaseExtractedAudioSilently(audioId) {
  if (!audioId) return;
  cleanupExtractedAudioAdapter(audioId).catch(() => {});
}

function postFormDataJsonWithProgress(url, formData, onUploadProgress = () => {}, onServerProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let finished = false;
    let simulatedProgress = 35;
    let progressTimer = 0;

    const stopTimer = () => {
      if (progressTimer) {
        window.clearInterval(progressTimer);
        progressTimer = 0;
      }
    };

    const fail = (error) => {
      stopTimer();
      if (finished) return;
      finished = true;
      reject(error);
    };

    xhr.open("POST", url, true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const ratio = event.loaded / event.total;
      onUploadProgress(Math.max(0, Math.min(100, Math.round(ratio * 100))));
    });

    xhr.upload.addEventListener("load", () => {
      simulatedProgress = Math.max(simulatedProgress, 35);
      onServerProgress(simulatedProgress);
      progressTimer = window.setInterval(() => {
        simulatedProgress = Math.min(92, simulatedProgress + (simulatedProgress < 70 ? 6 : 3));
        onServerProgress(simulatedProgress);
      }, 700);
    });

    xhr.addEventListener("error", () => fail(new Error("Language detection request failed.")));
    xhr.addEventListener("abort", () => fail(new Error("Language detection request was cancelled.")));
    xhr.addEventListener("load", () => {
      stopTimer();
      if (finished) return;
      finished = true;

      let responseText = "";
      try {
        responseText = xhr.responseText || "";
      } catch {
        responseText = "";
      }
      const payload = xhr.response && typeof xhr.response === "object"
        ? xhr.response
        : safeJsonParse(responseText);

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload?.error || "Language detection failed."));
        return;
      }

      onServerProgress(100);
      resolve(payload);
    });

    xhr.send(formData);
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
      navigator.serviceWorker.register(`sw.js?v=${APP_ASSET_VERSION}`, {
        updateViaCache: "none"
      });
    });
  }
}
