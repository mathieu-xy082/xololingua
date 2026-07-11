import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

test("service worker precaches JavaScript modules imported by the PWA shell", () => {
  const importedModules = [...appSource.matchAll(/import\s+[^;]+from\s+["']\.\/(frontend\/[^"']+)["']/g)]
    .map((match) => match[1])
    .sort();
  const cachedAssets = [...serviceWorkerSource.matchAll(/["'](frontend\/[^"']+\.js)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(cachedAssets, importedModules);
});

test("PWA shell starts from the hybrid pipeline router contract", () => {
  assert.match(
    appSource,
    /import\s+\{\s*collectClientPipelineCapabilities\s*\}\s+from\s+["']\.\/frontend\/client_pipeline_capabilities\.js["']/,
  );
  assert.match(
    appSource,
    /import\s+\{\s*createHybridPipelineRouter\s*\}\s+from\s+["']\.\/frontend\/client_pipeline_router\.js["']/,
  );
});
