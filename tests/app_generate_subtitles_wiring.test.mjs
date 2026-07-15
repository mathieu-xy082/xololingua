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
