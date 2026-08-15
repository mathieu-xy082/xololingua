import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collectClientPipelineCapabilities } from "../frontend/client_pipeline_capabilities.js";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("app enables on-demand model delivery and injects pair-aware resolvers", () => {
  assert.match(appSource, /__xololinguaDynamicModels\s*=\s*true/);
  assert.match(appSource, /modelResolver:\s*resolveTranscriptionModel/);
  assert.match(appSource, /modelResolver:\s*resolveTranslationModel/);
  assert.match(appSource, /purgeAfterUse:\s*true/g);
});

test("dynamic ML stages stay browser-routable before static model bootstrap", () => {
  const report = collectClientPipelineCapabilities({
    Worker() {},
    __xololinguaDynamicModels: true,
    navigator: {},
  });

  assert.equal(report.stages.transcription.runtime, "browser");
  assert.equal(report.stages.translation.runtime, "browser");
  assert.equal(report.stages.transcription.modelDelivery, "on-demand");
  assert.equal(report.stages.translation.modelRetention, "purge-after-use");
});

test("PWA explains automatic transient delivery instead of exposing manual setup", () => {
  assert.match(indexSource, /Models are downloaded automatically for the selected language pair and purged after use\./);
  assert.match(indexSource, /id="modelBootstrapButton"[^>]*hidden/);
  assert.match(appSource, /models are downloaded automatically for the selected language pair and purged after subtitle generation/i);
});

test("service worker leaves cross-origin model responses to the transient Transformers.js cache", () => {
  assert.match(serviceWorkerSource, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(serviceWorkerSource, /frontend\/dynamic_model_resolver\.js/);
});
