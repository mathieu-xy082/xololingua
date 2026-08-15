import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("app subtitle generation routes transcription and translation as separate hybrid stages", () => {
  assert.match(appSource, /hybridPipelineRouter\.runTranscription\(/);
  assert.match(appSource, /hybridPipelineRouter\.runTranslation\(/);
  assert.match(appSource, /state\.pipelineStageReports = \[\.\.\.state\.pipelineStageReports, \{ stage: "transcription", \.\.\.transcription \}, \{ stage: "translation", \.\.\.translation \}\];/);
  assert.doesNotMatch(appSource, /const translatedSegments = await runSubtitleJobAdapter\(/);
  assert.match(appSource, /Subtitle generation: \$\{formatPipelineStageRuntime\(\{ stage: "translation", \.\.\.translation \}\)\}/);
});

test("app keeps a readable hybrid pipeline report across segmentation and subtitle generation", () => {
  assert.match(appSource, /pipelineStageReports: \[\]/);
  assert.match(appSource, /state\.pipelineStageReports = stageReports;/);
  assert.match(appSource, /state\.pipelineStageReports = \[\.\.\.state\.pipelineStageReports, \{ stage: "transcription", \.\.\.transcription \}, \{ stage: "translation", \.\.\.translation \}\];/);
  assert.match(appSource, /formatPipelineStageSummary\(state\.pipelineStageReports\)/);
});

test("app maps direct translation endpoint progress without subtitle-job scaling", () => {
  assert.match(appSource, /typeof job\.translationProgress === "number"/);
  assert.match(appSource, /setSubtitleProgress\(100, job\.translationProgress\)/);
});

test("app segmentation no longer exposes legacy direct backend adapters outside the hybrid router", () => {
  assert.doesNotMatch(appSource, /function extractAudioAdapter\(/);
  assert.doesNotMatch(appSource, /function serviceSegmentAudioAdapter\(/);
});

test("app consumes canonical VAD stage payload segments while preserving segment review", () => {
  assert.match(appSource, /finishSegmentation\(segmentation\.payload\.segments, stageReports\)/);
});

test("app carries canonical audio extraction metadata into segmentation status details", () => {
  assert.match(appSource, /state\.extractedAudio = \{ \.\.\.extraction\.payload, \.\.\.extraction\.metadata \};/);
  assert.match(appSource, /formatBytes\(state\.extractedAudio\.audioSizeBytes\)/);
});

test("app consumes canonical transcription and translation stage payload segments", () => {
  assert.match(appSource, /state\.segments = transcription\.payload\.segments;/);
  assert.match(appSource, /segments: transcription\.payload\.segments,/);
  assert.match(appSource, /state\.segments = translation\.payload\.segments;/);
  assert.doesNotMatch(appSource, /state\.segments = transcription\.payload;/);
  assert.doesNotMatch(appSource, /state\.segments = translation\.payload;/);
});

test("app uses the canonical SRT formatting stage output for downloads and reports", () => {
  assert.match(appSource, /const srtFormatting = await hybridPipelineRouter\.runSrtFormatting\(/);
  assert.match(appSource, /const srt = srtFormatting\.payload\.srtText;/);
  assert.match(appSource, /\{ stage: "srtFormatting", \.\.\.srtFormatting \}/);
  assert.doesNotMatch(appSource, /const srt = await generateSrtAdapter\(/);
});

test("app configures browser VAD segmentation adapter with the backend-compatible profile", () => {
  assert.match(appSource, /createClientAudioExtractor/);
  assert.match(appSource, /createClientVadSegmenter/);
  assert.match(appSource, /clientAudioExtractor:/);
  assert.match(appSource, /clientVadSegmenter:/);
  assert.match(appSource, /XOLOLINGUA_CLIENT_VAD_SEGMENTER/);
  assert.match(appSource, /createVadWebRuntimeSegmenter\(\{\s*vadProfile:\s*["']backend-compatible["'],?\s*\}\)/);
});

test("app configures local ffmpeg wasm audio extraction instead of relying on WebCodecs-only detection", () => {
  assert.match(appSource, /createAppFfmpegWasmAudioExtractor/);
  assert.match(appSource, /ffmpegWasmExtractor:\s*createAppFfmpegWasmAudioExtractor\(\)/);
  assert.match(appSource, /globalThis\.XOLOLINGUA_CLIENT_AUDIO_EXTRACTOR \|\| createClientAudioExtractor\(\{/);
});

test("app configures browser ASR with the dynamic ML download timeout", () => {
  assert.match(appSource, /import\s+\{\s*createClientTranscriber\s*\}\s+from\s+["']\.\/frontend\/client_transcriber\.js["']/);
  assert.match(appSource, /globalThis\.XOLOLINGUA_CLIENT_TRANSCRIBER\s*\|\|\s*createClientTranscriber\(\{/);
  assert.match(appSource, /workerUrl:\s*["']frontend\/transcription_worker\.js["']/);
  assert.match(appSource, /warmupTimeoutMs:\s*BROWSER_ML_CONFIG\.modelDownloadTimeoutMs/);
  assert.match(appSource, /maxWorkerResponseMs:\s*BROWSER_ML_CONFIG\.transcription\.inferenceTimeoutMs/);
});

test("app configures browser translation with dynamic ML limits", () => {
  assert.match(appSource, /import\s+\{\s*createClientTranslator\s*\}\s+from\s+["']\.\/frontend\/client_translator\.js["']/);
  assert.match(appSource, /globalThis\.XOLOLINGUA_CLIENT_TRANSLATOR\s*\|\|\s*createClientTranslator\(\{/);
  assert.match(appSource, /workerUrl:\s*["']frontend\/translation_worker\.js["']/);
  assert.match(appSource, /modelId:\s*BROWSER_ML_CONFIG\.translation\.defaultModelId/);
  assert.match(appSource, /warmupTimeoutMs:\s*BROWSER_ML_CONFIG\.modelDownloadTimeoutMs/);
  assert.match(appSource, /warmupSampleText:\s*BROWSER_ML_CONFIG\.translation\.warmupSampleText/);
  assert.match(appSource, /maxWorkerResponseMs:\s*BROWSER_ML_CONFIG\.translation\.inferenceTimeoutMs/);
});

test("app no longer waits for static browser model bootstrap", () => {
  assert.match(appSource, /const clientPipelineCapabilities = collectClientPipelineCapabilities\(\)/);
  assert.doesNotMatch(appSource, /collectClientPipelineCapabilitiesWithModelAssetBootstrap/);
  assert.doesNotMatch(appSource, /modelAssetBootstrap/);
});
