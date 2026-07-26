"""Tests for preparing packaged browser model assets."""

from __future__ import annotations

import importlib.util
import json
import re
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prepare_browser_model_assets.py"
PYPROJECT = ROOT / "pyproject.toml"
APP_MANIFEST_FIXTURE = '''const CACHE_URL_VERSION_SEPARATOR = "?v=";

export const BROWSER_MODEL_ASSET_MANIFEST = Object.freeze({
  version: "browser-model-assets-v1",
  models: Object.freeze({
    transcription: Object.freeze({
      stage: "transcription",
      provider: "transformers.js",
      strategy: "whisper-transformers.js",
      modelId: "Xenova/whisper-tiny",
      assets: Object.freeze([
        Object.freeze({
          name: "asr-manifest",
          url: "models/asr/whisper-tiny/manifest.json",
          bytes: 151_000_000,
          sha256: "pending-real-asset-checksum",
          required: true,
        }),
      ]),
    }),
    translation: Object.freeze({
      stage: "translation",
      provider: "transformers.js",
      strategy: "opus-mt-transformers.js",
      modelId: "Xenova/opus-mt-fr-en",
      assets: Object.freeze([
        Object.freeze({
          name: "translation-manifest",
          url: "models/translation/opus-mt-fr-en/manifest.json",
          bytes: 625_000_000,
          sha256: "pending-real-asset-checksum",
          required: true,
        }),
      ]),
    }),
  }),
});
'''


class PrepareBrowserModelAssetsTests(unittest.TestCase):
    def load_module(self):
        spec = importlib.util.spec_from_file_location("prepare_browser_model_assets", SCRIPT)
        self.assertIsNotNone(spec)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        self.assertIsNotNone(spec.loader)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module

    def test_prepare_browser_model_assets_script_exists_and_exposes_main(self):
        self.assertTrue(SCRIPT.is_file(), "scripts/prepare_browser_model_assets.py should exist")
        module = self.load_module()
        self.assertTrue(callable(module.main))
        self.assertTrue(callable(module.prepare_browser_model_assets))

    def test_pdm_script_exposes_prepare_browser_model_assets(self):
        pyproject = PYPROJECT.read_text(encoding="utf-8")
        self.assertRegex(
            pyproject,
            re.compile(r'^prepare-browser-model-assets\s*=\s*"python scripts/prepare_browser_model_assets\.py"$', re.MULTILINE),
        )

    def test_prepare_copies_packaged_assets_generates_manifests_and_updates_app_manifest(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asr_source = root / "hf" / "asr"
            translation_source = root / "hf" / "translation"
            asr_source.mkdir(parents=True)
            translation_source.mkdir(parents=True)
            (asr_source / "config.json").write_text('{"model_type":"whisper"}', encoding="utf-8")
            (asr_source / "model.onnx").write_bytes(b"fake-asr-onnx")
            (translation_source / "tokenizer.json").write_text('{"model":"opus-mt"}', encoding="utf-8")
            (translation_source / "encoder_model.onnx").write_bytes(b"fake-translation-onnx")
            app_manifest = root / "frontend" / "model_asset_manifest.js"
            app_manifest.parent.mkdir(parents=True)
            app_manifest.write_text(APP_MANIFEST_FIXTURE, encoding="utf-8")

            report = module.prepare_browser_model_assets(
                models_root=root / "models",
                app_manifest_path=app_manifest,
                asr_source=asr_source,
                translation_source=translation_source,
                copy_mode="copy",
            )

            self.assertEqual(report["status"], "ready")
            self.assertEqual(report["modelsRoot"], str(root / "models"))
            asr_manifest = root / "models" / "asr" / "whisper-tiny" / "manifest.json"
            translation_manifest = root / "models" / "translation" / "opus-mt-fr-en" / "manifest.json"
            self.assertTrue(asr_manifest.is_file())
            self.assertTrue(translation_manifest.is_file())
            self.assertTrue((root / "models" / "Xenova" / "whisper-tiny" / "model.onnx").is_file())
            self.assertTrue((root / "models" / "Xenova" / "opus-mt-fr-en" / "encoder_model.onnx").is_file())

            asr_data = json.loads(asr_manifest.read_text(encoding="utf-8"))
            translation_data = json.loads(translation_manifest.read_text(encoding="utf-8"))
            self.assertEqual(asr_data["modelId"], "Xenova/whisper-tiny")
            self.assertEqual(translation_data["modelId"], "Xenova/opus-mt-fr-en")
            self.assertGreaterEqual(len(asr_data["assets"]), 2)
            self.assertGreaterEqual(len(translation_data["assets"]), 2)
            for manifest in [asr_data, translation_data]:
                for asset in manifest["assets"]:
                    self.assertTrue(asset["url"].startswith("models/Xenova/"))
                    self.assertNotRegex(asset["url"], r"^https?://")
                    packaged = root / asset["url"]
                    self.assertEqual(asset["bytes"], packaged.stat().st_size)
                    self.assertEqual(asset["sha256"], sha256(packaged.read_bytes()).hexdigest())

            updated = app_manifest.read_text(encoding="utf-8")
            self.assertNotIn("pending-real-asset-checksum", updated)
            self.assertIn('name: "asr-manifest"', updated)
            self.assertIn('url: "models/asr/whisper-tiny/manifest.json"', updated)
            self.assertIn('url: "models/Xenova/whisper-tiny/model.onnx"', updated)
            self.assertIn('url: "models/Xenova/opus-mt-fr-en/encoder_model.onnx"', updated)
            self.assertIn(json.dumps(sha256(asr_manifest.read_bytes()).hexdigest()), updated)
            self.assertIn(json.dumps(sha256(translation_manifest.read_bytes()).hexdigest()), updated)

    def test_prepare_rejects_missing_source_directory_with_actionable_message(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_manifest = root / "frontend" / "model_asset_manifest.js"
            app_manifest.parent.mkdir(parents=True)
            app_manifest.write_text(APP_MANIFEST_FIXTURE, encoding="utf-8")

            with self.assertRaisesRegex(FileNotFoundError, "ASR source directory not found"):
                module.prepare_browser_model_assets(
                    models_root=root / "models",
                    app_manifest_path=app_manifest,
                    asr_source=root / "missing-asr",
                    translation_source=root / "missing-translation",
                )

    def test_resolve_source_uses_latest_huggingface_snapshot_candidate(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_root = root / "models--Xenova--whisper-tiny" / "snapshots"
            old_snapshot = snapshot_root / "000-old"
            new_snapshot = snapshot_root / "111-new"
            old_snapshot.mkdir(parents=True)
            new_snapshot.mkdir(parents=True)
            (old_snapshot / "config.json").write_text("old", encoding="utf-8")
            (new_snapshot / "config.json").write_text("new", encoding="utf-8")
            resolved = module.find_latest_snapshot(root / "models--Xenova--whisper-tiny")

        self.assertEqual(resolved, new_snapshot.resolve())


if __name__ == "__main__":
    unittest.main()
