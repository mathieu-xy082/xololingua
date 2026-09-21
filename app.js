import { createBackendClient } from "./frontend/backend_client.js";
import { createAppClientAdapters, createAppHybridPipelineRouter } from "./frontend/app_hybrid_router_wiring.js";
import { createClientAudioExtractor } from "./frontend/client_audio_extractor.js";
import { createClientLanguageDetector } from "./frontend/client_language_detector.js";
import { createClientTranscriber } from "./frontend/client_transcriber.js";
import { createClientTranslator } from "./frontend/client_translator.js";
import { BROWSER_ML_CONFIG } from "./frontend/browser_ml_config.js";
import { BROWSER_MAX_VIDEO_BYTES } from "./frontend/browser_resource_limits.js";
import { resolveTranscriptionModel, resolveTranslationModel } from "./frontend/dynamic_model_resolver.js";
import { collectClientPipelineCapabilities } from "./frontend/client_pipeline_capabilities.js";
import { formatSrt, formatSrtTime } from "./frontend/client_srt_formatter.js";
import { createClientVadSegmenter } from "./frontend/client_vad_segmenter.js";
import { createAppFfmpegWasmAudioExtractor } from "./frontend/ffmpeg_wasm_runtime.js";
import { formatPipelineStageRuntime, formatPipelineStageSummary } from "./frontend/pipeline_stage_status.js";
import { resolveServiceBaseUrl } from "./frontend/service_url.js";
import { createVadWebRuntimeSegmenter } from "./frontend/vad_web_runtime.js";
import { resolveVideoDurationPolicy } from "./frontend/video_duration_policy.js";
import {
  beginModelDelivery,
  createModelDeliveryTracker,
  describeModelDelivery,
  failModelDelivery,
  finishModelDelivery,
  updateModelDelivery,
} from "./frontend/model_delivery_status.js";

const VIDEO_DURATION_POLICY = resolveVideoDurationPolicy();
const SEGMENT_SECONDS = 12;
const SERVICE_BASE_URL = resolveServiceBaseUrl();
globalThis.__xololinguaDynamicModels = true;
const APP_ASSET_VERSION = "2026-09-21-1";
const backendClient = createBackendClient({ baseUrl: SERVICE_BASE_URL });
const clientPipelineCapabilities = collectClientPipelineCapabilities();
const appClientAdapters = createAppClientAdapters({
  clientAudioExtractor: globalThis.XOLOLINGUA_CLIENT_AUDIO_EXTRACTOR || createClientAudioExtractor({
    ffmpegWasmExtractor: createAppFfmpegWasmAudioExtractor(),
  }),
  clientLanguageDetector: globalThis.XOLOLINGUA_CLIENT_LANGUAGE_DETECTOR || createClientLanguageDetector({
    workerUrl: "frontend/transcription_worker.js",
    modelId: BROWSER_ML_CONFIG.languageDetection.defaultModelId,
    modelResolver: resolveTranscriptionModel,
    remoteModels: true,
    dtype: "q4",
    devicePreference: BROWSER_ML_CONFIG.devicePreference,
    sampleCount: BROWSER_ML_CONFIG.languageDetection.sampleCount,
    sampleSeconds: BROWSER_ML_CONFIG.languageDetection.sampleSeconds,
    confidenceThreshold: BROWSER_ML_CONFIG.languageDetection.confidenceThreshold,
    maxWorkerResponseMs: BROWSER_ML_CONFIG.languageDetection.inferenceTimeoutMs,
  }),
  clientVadSegmenter: globalThis.XOLOLINGUA_CLIENT_VAD_SEGMENTER || createClientVadSegmenter({
    maxDurationSeconds: BROWSER_ML_CONFIG.vad.maxAudioSeconds,
    maxAudioBytes: BROWSER_ML_CONFIG.vad.maxAudioBytes,
    vadWebSegmenter: createVadWebRuntimeSegmenter({
      vadProfile: "backend-compatible",
      workerUrl: "frontend/vad_worker.js",
    }),
  }),
  clientTranscriber: globalThis.XOLOLINGUA_CLIENT_TRANSCRIBER || createClientTranscriber({
    workerUrl: "frontend/transcription_worker.js",
    modelId: BROWSER_ML_CONFIG.transcription.defaultModelId,
    modelResolver: resolveTranscriptionModel,
    remoteModels: true,
    purgeAfterUse: true,
    devicePreference: BROWSER_ML_CONFIG.devicePreference,
    warmupTimeoutMs: BROWSER_ML_CONFIG.modelDownloadTimeoutMs,
    warmupSampleSeconds: BROWSER_ML_CONFIG.transcription.warmupSampleSeconds,
    maxDurationSeconds: BROWSER_ML_CONFIG.transcription.maxAudioSeconds,
    maxAudioBytes: BROWSER_ML_CONFIG.transcription.maxAudioBytes,
    maxSegments: BROWSER_ML_CONFIG.transcription.maxSegments,
    maxWorkerResponseMs: BROWSER_ML_CONFIG.transcription.inferenceTimeoutMs,
  }),
  clientTranslator: globalThis.XOLOLINGUA_CLIENT_TRANSLATOR || createClientTranslator({
    workerUrl: "frontend/translation_worker.js",
    modelId: BROWSER_ML_CONFIG.translation.defaultModelId,
    modelResolver: resolveTranslationModel,
    remoteModels: true,
    purgeAfterUse: true,
    devicePreference: BROWSER_ML_CONFIG.devicePreference,
    warmupTimeoutMs: BROWSER_ML_CONFIG.modelDownloadTimeoutMs,
    warmupSampleText: BROWSER_ML_CONFIG.translation.warmupSampleText,
    maxDurationSeconds: BROWSER_ML_CONFIG.translation.maxMediaSeconds,
    maxSegments: BROWSER_ML_CONFIG.translation.maxSegments,
    maxBatchSize: Math.max(1, Math.floor(
      BROWSER_ML_CONFIG.translation.maxCharactersPerBatch / 400,
    )),
    maxWorkerResponseMs: BROWSER_ML_CONFIG.translation.inferenceTimeoutMs,
  }),
});
const hybridPipelineRouter = createAppHybridPipelineRouter({
  backendClient,
  capabilityReport: clientPipelineCapabilities,
  clientAdapters: appClientAdapters,
  srtFormatter: formatSrt,
  allowServerFallback: !VIDEO_DURATION_POLICY.publicSite,
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
  sourceLanguageManuallySelected: false,
  targetLanguage: "",
  languageProgress: 0,
  extractedAudio: null,
  audioExtractionReport: null,
  segments: [],
  pipelineStageReports: [],
  srtUrl: "",
  subtitleJobId: "",
  subtitleCancelRequested: false,
  subtitleNotice: "",
  subtitleTranscriptionProgress: 0,
  subtitleTranslationProgress: 0,
  modelDelivery: createModelDeliveryTracker(),
  busyStep: ""
};

const els = {
  dropzone: document.querySelector("#dropzone"),
  uploadNotice: document.querySelector("#uploadNotice"),
  maxDurationLabel: document.querySelector("#maxDurationLabel"),
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
  sourceLanguageSelect: document.querySelector("#sourceLanguageSelect"),
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
  pipelineFallbackEndpoints: document.querySelector("#pipelineFallbackEndpoints"),
  modelDeliveryPanel: document.querySelector("#modelDeliveryPanel"),
  modelDeliveryStatus: document.querySelector("#modelDeliveryStatus"),
  modelDeliveryProgressText: document.querySelector("#modelDeliveryProgressText"),
  modelDeliveryProgressBar: document.querySelector("#modelDeliveryProgressBar")
};

let deferredInstallPrompt = null;
let _pairsFetched = false;
if (els.uploadNotice) els.uploadNotice.hidden = SERVICE_BASE_URL !== globalThis.location?.origin;
els.maxDurationLabel.textContent = VIDEO_DURATION_POLICY.label;
populateLanguages();
bindEvents();
bindInstallPrompt();
renderPipelineCapabilitySummary();
registerServiceWorker();
render();
fetchServiceStatus();
fetchTranslationPairs();

function populateLanguages() {
  els.sourceLanguageSelect.replaceChildren();
  els.targetLanguageSelect.replaceChildren();

  const sourcePlaceholder = document.createElement("option");
  sourcePlaceholder.value = "";
  sourcePlaceholder.textContent = "Select source language";
  els.sourceLanguageSelect.append(sourcePlaceholder);

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select target language";
  els.targetLanguageSelect.append(placeholder);

  languages.forEach((language) => {
    for (const select of [els.sourceLanguageSelect, els.targetLanguageSelect]) {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = language.name;
      select.append(option);
    }
  });
}

function renderPipelineCapabilitySummary() {
  const summary = clientPipelineCapabilities.demoSummary;
  if (VIDEO_DURATION_POLICY.publicSite) {
    els.pwaOfflineScope.textContent = "All media processing runs in your browser; model files are downloaded on demand.";
    els.pwaOfflineScope.title = "Browser processing requires enough memory and a supported browser.";
    els.pipelineBrowserStages.textContent = summary.browserStageLabels.join(", ") || "none available";
    els.pipelineFallbackStages.textContent = summary.serverFallbackStageLabels.length > 0
      ? `Unavailable in this browser: ${summary.serverFallbackStageLabels.join(", ")}`
      : "Disabled on the public site";
    els.pipelineFallbackEndpoints.replaceChildren();
    renderModelDeliveryPanel();
    return;
  }
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
  renderModelDeliveryPanel();
}

function renderModelDeliveryPanel() {
  if (!els.modelDeliveryPanel) return;
  const delivery = describeModelDelivery(state.modelDelivery);
  els.modelDeliveryStatus.textContent = delivery.status;
  els.modelDeliveryProgressText.textContent = delivery.progressText;
  els.modelDeliveryProgressBar.style.width = `${delivery.progress}%`;
}

async function fetchTranslationPairs() {
  if (_pairsFetched) return;
  if (VIDEO_DURATION_POLICY.publicSite) return;
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
  if (VIDEO_DURATION_POLICY.publicSite) {
    els.serviceWhisperBackend.textContent = "Transformers.js";
    els.serviceWhisperModel.textContent = BROWSER_ML_CONFIG.transcription.defaultModelId;
    els.serviceWhisperDevice.textContent = clientPipelineCapabilities.stages.languageDetection.webGpu
      ? "WebGPU / local WASM fallback"
      : "Local WASM CPU";
    return;
  }
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
  els.sourceLanguageSelect.addEventListener("change", () => {
    const language = getLanguage(els.sourceLanguageSelect.value);
    selectSourceLanguage(language, Boolean(language));
    els.languageStatus.textContent = language
      ? `Source language selected manually: ${language.name}.`
      : "Select a source language or run identification.";
    setProgress("language", language ? 100 : 0);
  });
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

  if (VIDEO_DURATION_POLICY.publicSite && file.size > BROWSER_MAX_VIDEO_BYTES) {
    els.languageStatus.textContent = "This MP4 exceeds the 400 MiB browser processing limit. Compress or trim it before trying again.";
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
    resetOutput();
    els.languageStatus.textContent = "The video duration could not be read.";
    return;
  }

  if (state.duration > VIDEO_DURATION_POLICY.maxDurationSeconds) {
    resetOutput();
    els.languageStatus.textContent = `This video exceeds the ${VIDEO_DURATION_POLICY.label} limit.`;
    return;
  }

  state.metadataReady = true;
  els.languageStatus.textContent = "Ready to identify the main language.";
}

async function identifyLanguage() {
  if (!state.videoFile) return;

  state.busyStep = "language";
  els.languageStatus.textContent = "Identifying main language...";
  setProgress("language", 0);
  render();

  try {
    if (!state.extractedAudio) {
      els.languageStatus.textContent = "Extracting audio in your browser...";
      const extraction = await hybridPipelineRouter.runAudioExtraction(state.videoFile, (progress) => {
        setProgress("language", Math.round(Number(progress || 0) * 0.3));
      });
      state.audioExtractionReport = { stage: "audioExtraction", ...extraction };
      state.extractedAudio = {
        ...extraction.payload,
        ...extraction.metadata,
        durationSeconds: Number.isFinite(extraction.payload.durationSeconds)
          ? extraction.payload.durationSeconds
          : state.duration,
      };
    }

    const detected = await appClientAdapters.languageDetection(
      { audio: state.extractedAudio },
      (event) => updateLanguageDetectionProgress(event),
    );
    const language = getLanguage(detected.languageCode);
    if (!language) {
      throw new Error(`Detected unsupported language code: ${detected.languageCode || "unknown"}.`);
    }
    selectSourceLanguage(language);
    const confidence = Number.isFinite(detected.confidence)
      ? `, ${Math.round(detected.confidence * 100)}% confidence`
      : "";
    const device = detected.executionDeviceLabel || detected.executionDevice || "browser";
    els.languageStatus.textContent = detected.lowConfidence
      ? `Likely ${language.name} (${device}${confidence}). Confidence is low; correct the source language below if needed.`
      : `Main language identified as ${language.name} (${device}${confidence}).`;
    setProgress("language", 100);
  } catch (error) {
    els.languageStatus.textContent = languageIdentificationFailureMessage(error);
    setProgress("language", 0);
  } finally {
    state.busyStep = "";
    render();
  }
}

function languageIdentificationFailureMessage(error) {
  const reason = String(error?.message || "Language identification failed.");
  if (!VIDEO_DURATION_POLICY.publicSite) return reason;
  if (/memory|allocation|out of bounds|out of memory/i.test(reason)) {
    return "The browser ran out of memory during language identification. Close other tabs or use a shorter video, then retry. You can also select the source language manually.";
  }
  if (/fetch|download|network|model/i.test(reason)) {
    return "The Whisper model could not be loaded. Check your connection and retry, or select the source language manually.";
  }
  if (/webgpu|wasm|worker|device lost/i.test(reason)) {
    return "Browser inference failed on both WebGPU and local WASM CPU. Update Chrome or Chromium, then retry, or select the source language manually.";
  }
  return `${reason} You can select the source language manually to continue.`;
}

function updateLanguageDetectionProgress(event = {}) {
  const progress = Math.max(0, Math.min(100, Number(event.progress || 0)));
  const stage = event.stage || "detecting-language";
  if (stage === "decoding-language-audio") {
    setProgress("language", 30 + Math.round(progress * 0.08));
  } else if (stage === "preparing-language-samples") {
    setProgress("language", 38 + Math.round(progress * 0.04));
  } else if (stage === "loading-language-model" || stage === "loading-model") {
    setProgress("language", 42 + Math.round(progress * 0.28));
  } else if (stage === "detecting-language") {
    setProgress("language", 70 + Math.round(progress * 0.28));
  } else if (stage === "aggregating-language") {
    setProgress("language", 99);
  }
  if (event.message) els.languageStatus.textContent = event.message;
}

function selectSourceLanguage(language, manuallySelected = false) {
  const changed = state.sourceLanguage?.code !== language?.code;
  state.sourceLanguage = language;
  state.sourceLanguageManuallySelected = manuallySelected;
  if (state.targetLanguage && (!language || !isSupportedPair(language.code, state.targetLanguage))) {
    state.targetLanguage = "";
  }
  if (changed) resetSegmentation();
  render();
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

  const stageReports = state.audioExtractionReport ? [state.audioExtractionReport] : [];
  if (!state.extractedAudio) {
    try {
      const extraction = await hybridPipelineRouter.runAudioExtraction(state.videoFile, (progress) => {
        setProgress("segmentation", progress);
      });
      stageReports.push({ stage: "audioExtraction", ...extraction });
      state.audioExtractionReport = { stage: "audioExtraction", ...extraction };
      state.extractedAudio = {
        ...extraction.payload,
        ...extraction.metadata,
        durationSeconds: Number.isFinite(extraction.payload.durationSeconds)
          ? extraction.payload.durationSeconds
          : state.duration,
      };
      els.segmentationStatus.textContent = `${formatPipelineStageRuntime({ stage: "audioExtraction", ...extraction })}. Segmenting speech audio...`;
    } catch (extractionError) {
      if (VIDEO_DURATION_POLICY.publicSite) {
        failPublicSegmentation(extractionError);
        return;
      }
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
    const segmentation = await hybridPipelineRouter.runVadSegmentation(state.extractedAudio, (progress) => {
      const scaledProgress = 50 + Math.round(progress * 0.5);
      setProgress("segmentation", scaledProgress);
    });
    stageReports.push({ stage: "vad", ...segmentation });
    finishSegmentation(segmentation.payload.segments, stageReports);
  } catch (segmentationError) {
    if (VIDEO_DURATION_POLICY.publicSite) {
      failPublicSegmentation(segmentationError);
      return;
    }
    els.segmentationStatus.textContent = `${segmentationError.message} Falling back to prototype segmentation.`;
    const segments = await segmentAudioAdapter(state.duration, (progress) => {
      const scaledProgress = 35 + Math.round(progress * 0.65);
      setProgress("segmentation", scaledProgress);
    });
    finishSegmentation(segments, stageReports);
  }
}

function failPublicSegmentation(error) {
  state.busyStep = "";
  state.segments = [];
  els.segmentationStatus.textContent = error.message;
  setProgress("segmentation", 0);
  render();
}

async function generateSubtitles() {
  if (!canGenerate()) return;
  state.busyStep = "subtitle";
  state.subtitleJobId = "";
  state.subtitleCancelRequested = false;
  state.subtitleNotice = "";
  els.subtitleStatus.textContent = "Starting subtitle generation job...";
  setSubtitleProgress(0, 0);
  const transcriptionModel = resolveTranscriptionModel({ sourceLanguage: state.sourceLanguage });
  state.modelDelivery = beginModelDelivery(state.modelDelivery, transcriptionModel);
  render();

  try {
    const transcription = await hybridPipelineRouter.runTranscription(
      {
        audioId: state.extractedAudio.audioId,
        audio: state.extractedAudio,
        sourceLanguage: state.sourceLanguage,
        segments: state.segments,
      },
      (job) => {
        state.modelDelivery = updateModelDelivery(state.modelDelivery, job);
        renderModelDeliveryPanel();
        els.subtitleStatus.textContent = job.message || job.stage;
        syncSubtitleProgress(job);
      },
    );
    state.modelDelivery = finishModelDelivery(state.modelDelivery, {
      stageResult: transcription,
      modelId: transcriptionModel.modelId,
    });
    setSubtitleProgress(100, 0);
    state.segments = transcription.payload.segments;
    renderSegmentReview();
    els.subtitleStatus.textContent = `Subtitle generation: ${formatPipelineStageRuntime({ stage: "transcription", ...transcription })}. Translating subtitles...`;

    const translationModel = resolveTranslationModel({
      sourceLanguage: state.sourceLanguage,
      targetLanguage: state.targetLanguage,
    });
    state.modelDelivery = beginModelDelivery(state.modelDelivery, translationModel);
    renderModelDeliveryPanel();
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
        state.modelDelivery = updateModelDelivery(state.modelDelivery, job);
        renderModelDeliveryPanel();
        els.subtitleStatus.textContent = job.message || job.stage;
        syncSubtitleProgress(job);
      },
    );
    state.modelDelivery = finishModelDelivery(state.modelDelivery, {
      stageResult: translation,
      modelId: translationModel.modelId,
    });
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
    state.modelDelivery = failModelDelivery(state.modelDelivery, error);
    state.subtitleNotice = error.cancelled ? "Subtitle generation cancelled." : error.message;
    state.busyStep = "";
    state.subtitleJobId = "";
    state.subtitleCancelRequested = false;
    setSubtitleProgress(0, 0);
    render();
  }
}

async function cancelSubtitleGeneration() {
  if (state.busyStep !== "subtitle" || state.subtitleCancelRequested) return;

  const jobId = state.subtitleJobId;
  state.subtitleCancelRequested = true;
  els.subtitleStatus.textContent = "Cancelling subtitle generation...";
  appClientAdapters.cancel?.();
  render();

  try {
    if (jobId) {
      const job = await cancelSubtitleJobAdapter(jobId);
      state.subtitleNotice = job.message || "Subtitle generation cancelled.";
    } else {
      state.subtitleNotice = "Subtitle generation cancelled.";
    }
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
    ? `Source language: ${sourceLanguage.name}${state.sourceLanguageManuallySelected ? " (selected manually)" : ""}`
    : "Source language: unknown";

  els.sourceLanguageSelect.disabled = !hasValidVideo || Boolean(state.busyStep);
  els.sourceLanguageSelect.value = sourceLanguage?.code || "";
  els.targetLanguageSelect.disabled = !sourceLanguage || Boolean(state.busyStep);
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
    els.targetStatus.textContent = "No browser translation route is available for this language pair.";
  } else {
    els.targetStatus.textContent = `Target selected: ${targetLanguage.name}.`;
  }

  els.segmentButton.disabled = !canSegment() || Boolean(state.busyStep);
  els.generateButton.disabled = !canGenerate() || Boolean(state.busyStep);
  els.cancelGenerateButton.hidden = state.busyStep !== "subtitle";
  els.cancelGenerateButton.disabled = state.subtitleCancelRequested;
  renderSegmentReview();
  renderSubtitleStatus();
  renderModelDeliveryPanel();
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
  if (state.busyStep === "language") appClientAdapters.cancel?.();
  if (state.videoFile || state.extractedAudio) {
    appClientAdapters.purgeLanguageCache?.().catch(() => {});
  }
  cancelActiveSubtitleJobSilently();
  releaseExtractedAudioSilently(audioId);
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoFile = null;
  state.videoUrl = "";
  state.duration = 0;
  state.metadataReady = false;
  state.sourceLanguage = null;
  state.sourceLanguageManuallySelected = false;
  state.targetLanguage = "";
  state.languageProgress = 0;
  state.extractedAudio = null;
  state.audioExtractionReport = null;
  state.pipelineStageReports = [];
  state.busyStep = "";
  els.videoPreview.removeAttribute("src");
  els.videoPreview.load();
  els.videoCard.hidden = true;
  els.fileInput.value = "";
  els.targetLanguageSelect.value = "";
  els.sourceLanguageSelect.value = "";
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
  state.modelDelivery = createModelDeliveryTracker();
  els.subtitleStatus.textContent = "Run segmentation first.";
  els.downloadLink.hidden = true;
  els.downloadLink.removeAttribute("href");
  els.downloadLink.removeAttribute("download");
  setSubtitleProgress(0, 0);
}

function cancelActiveSubtitleJobSilently() {
  if (state.busyStep !== "subtitle" || state.subtitleCancelRequested) return false;

  state.subtitleCancelRequested = true;
  appClientAdapters.cancel?.();
  if (state.subtitleJobId) cancelSubtitleJobAdapter(state.subtitleJobId).catch(() => {});
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

  if (
    state.modelDelivery.current?.stage === "transcription"
    && (job.stage === "loading-model" || job.stage === "asr-warmup")
  ) {
    const preparation = Math.max(1, Math.min(10, Math.round(state.modelDelivery.current.progress / 10)));
    setSubtitleProgress(preparation, 0);
    return;
  }

  if (
    state.modelDelivery.current?.stage === "translation"
    && (job.stage === "translation-route" || job.stage === "loading-model" || job.stage === "translation-warmup")
  ) {
    const preparation = typeof job.translationProgress === "number"
      ? clampProgress(job.translationProgress)
      : clampProgress(state.modelDelivery.current.progress);
    setSubtitleProgress(100, preparation);
    return;
  }

  if (job.stage === "transcribing") {
    if (typeof job.transcriptionProgress === "number") {
      const transcription = 10 + Math.round(clampProgress(job.transcriptionProgress) * 0.9);
      setSubtitleProgress(transcription, 0);
      return;
    }
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

  const response = await fetch(`${SERVICE_BASE_URL}/api/release-audio`, {
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
  try {
    return resolveTranslationModel({ sourceLanguage: sourceCode, targetLanguage: targetCode }).browserAvailable !== false;
  } catch {
    return false;
  }
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
