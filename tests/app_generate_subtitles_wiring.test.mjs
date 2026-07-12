import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("app subtitle generation is routed through the hybrid pipeline translation stage", () => {
  assert.match(appSource, /hybridPipelineRouter\.runTranslation\(/);
  assert.doesNotMatch(appSource, /const translatedSegments = await runSubtitleJobAdapter\(/);
  assert.match(appSource, /Subtitle generation: \$\{formatPipelineStageRuntime\(\{ stage: "translation", \.\.\.translation \}\)\}/);
});
