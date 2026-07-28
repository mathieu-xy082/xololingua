"""Checks for the browser E2E validation script wiring."""

from __future__ import annotations

import ast
import argparse
import contextlib
import importlib.util
import io
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "browser_e2e_validate.py"
PYPROJECT = ROOT / "pyproject.toml"


class BrowserE2EScriptTests(unittest.TestCase):
    def load_module(self, **env: str):
        with mock.patch.dict(os.environ, env, clear=False):
            spec = importlib.util.spec_from_file_location("browser_e2e_validate", SCRIPT)
            self.assertIsNotNone(spec)
            assert spec is not None
            module = importlib.util.module_from_spec(spec)
            self.assertIsNotNone(spec.loader)
            assert spec.loader is not None
            spec.loader.exec_module(module)
            return module

    def test_browser_e2e_script_exists_and_exposes_main(self):
        self.assertTrue(SCRIPT.is_file(), "scripts/browser_e2e_validate.py should exist")
        module = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        functions = {
            node.name
            for node in module.body
            if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("main", functions)

    def test_pdm_script_runs_browser_e2e_validator(self):
        pyproject = PYPROJECT.read_text(encoding="utf-8")
        self.assertRegex(
            pyproject,
            re.compile(r'^browser-e2e\s*=\s*"python scripts/browser_e2e_validate\.py"$', re.MULTILINE),
        )

    def test_browser_e2e_default_download_dir_is_outside_repository(self):
        module = self.load_module()

        self.assertNotIn(ROOT, module.DEFAULT_DOWNLOAD_DIR.parents)
        self.assertEqual(
            module.DEFAULT_DOWNLOAD_DIR,
            Path.home() / ".cache" / "xololingua" / "tmp" / "browser-e2e-downloads",
        )

    def test_xololingua_tmp_dir_overrides_browser_e2e_download_root(self):
        override = Path.home() / ".cache" / "xololingua-test" / "tmp"
        module = self.load_module(XOLOLINGUA_TMP_DIR=str(override))

        self.assertEqual(module.DEFAULT_DOWNLOAD_DIR, override / "browser-e2e-downloads")

    def test_browser_e2e_validator_rejects_timestamp_only_downloads(self):
        spec = importlib.util.spec_from_file_location("browser_e2e_validate", SCRIPT)
        self.assertIsNotNone(spec)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        self.assertIsNotNone(spec.loader)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as directory:
            bad_srt = Path(directory) / "timestamp-only.srt"
            bad_srt.write_text("1\n00:00:00,000 --> 00:00:01,000\n\n", encoding="utf-8")
            args = argparse.Namespace(
                min_srt_blocks=1,
                min_segments=1,
                min_srt_bytes=1,
                min_coverage_ratio=0.1,
            )
            with self.assertRaisesRegex(AssertionError, "subtitle text"):
                module.validate_srt(
                    bad_srt,
                    args,
                    duration_seconds=10.0,
                    segment_diagnostics={"count": 1, "lastEndSeconds": 1.0},
                )

    def test_collect_srt_diagnostics_reports_cue_duration_distribution(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            srt = Path(directory) / "sample.srt"
            srt.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n"
                "2\n00:00:02,000 --> 00:00:05,000\nWorld\n\n"
                "3\n00:00:06,000 --> 00:00:16,000\nAgain\n",
                encoding="utf-8",
            )

            diagnostics = module.collect_srt_diagnostics(srt)

        self.assertEqual(diagnostics["cueDurationsSeconds"], [1.0, 3.0, 10.0])
        self.assertEqual(diagnostics["medianCueDurationSeconds"], 3.0)
        self.assertEqual(diagnostics["p90CueDurationSeconds"], 10.0)
        self.assertEqual(diagnostics["lastEndSeconds"], 16.0)

    def test_compare_srt_outputs_prints_segmentation_quality_diagnostics_for_real_models(self):
        module = self.load_module()
        args = argparse.Namespace(
            compare_max_block_delta=2,
            compare_max_last_end_delta=5.0,
            compare_min_text_similarity=0.1,
            real_browser_models=True,
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            browser = root / "browser.srt"
            backend = root / "backend.srt"
            browser.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nalpha beta gamma\n\n"
                "2\n00:00:01,200 --> 00:00:02,200\nalpha beta gamma\n\n"
                "3\n00:00:02,400 --> 00:00:03,400\nalpha beta gamma\n\n"
                "4\n00:00:03,600 --> 00:00:04,600\nalpha beta gamma\n\n"
                "5\n00:00:04,800 --> 00:00:05,800\nalpha beta gamma\n",
                encoding="utf-8",
            )
            backend.write_text(
                "1\n00:00:00,000 --> 00:00:02,900\nalpha beta gamma\n\n"
                "2\n00:00:02,900 --> 00:00:05,800\nalpha beta gamma\n",
                encoding="utf-8",
            )
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                module.compare_srt_outputs(browser, backend, args)

        printed = output.getvalue()
        self.assertIn("browserMedianCue=1.000s", printed)
        self.assertIn("backendMedianCue=2.900s", printed)
        self.assertIn("blockRatio=2.500", printed)
        self.assertIn("medianCueRatio=0.345", printed)
        self.assertIn("segmentationWarning=browser block count is 2.50x backend", printed)

    def test_browser_e2e_exposes_require_browser_audio_guard(self):
        module = self.load_module()
        args = module.parse_args(["--require-browser-audio"])

        self.assertTrue(args.require_browser_audio)

    def test_browser_e2e_asserts_browser_audio_runtime_from_pipeline_status(self):
        module = self.load_module()

        module.assert_browser_audio_runtime(
            "Subtitle file ready. Pipeline: Audio extraction: Browser (ffmpeg.wasm); "
            "VAD / segmentation: Python fallback via POST /api/segment-audio."
        )

        with self.assertRaisesRegex(AssertionError, "Expected browser audio extraction"):
            module.assert_browser_audio_runtime(
                "Subtitle file ready. Pipeline: Audio extraction: Python fallback via POST /api/extract-audio."
            )

    def test_browser_e2e_exposes_require_browser_vad_guard(self):
        module = self.load_module()
        args = module.parse_args(["--require-browser-vad"])

        self.assertTrue(args.require_browser_vad)

    def test_browser_e2e_asserts_browser_vad_runtime_from_pipeline_status(self):
        module = self.load_module()

        module.assert_browser_vad_runtime(
            "Subtitle file ready. Pipeline: Audio extraction: Browser (ffmpeg.wasm); "
            "VAD / segmentation: Browser (vad-web); "
            "Transcription: Python fallback via POST /api/subtitle-jobs."
        )

        with self.assertRaisesRegex(AssertionError, "Expected browser VAD segmentation"):
            module.assert_browser_vad_runtime(
                "Subtitle file ready. Pipeline: Audio extraction: Browser (ffmpeg.wasm); "
                "VAD / segmentation: Python fallback via POST /api/segment-audio."
            )

    def test_backend_reference_injection_marks_deterministic_model_assets_cached(self):
        module = self.load_module()

        script = module.create_backend_reference_init_script({"translatedSegments": []})

        self.assertIn("window.__xololinguaCachedModelAssetUrls", script)
        self.assertIn(f"{module.REAL_MODEL_ASSET_MANIFEST_PATHS[0]}?v=browser-model-assets-v1", script)
        self.assertIn("models/Xenova/whisper-base/added_tokens.json?v=browser-model-assets-v1", script)
        self.assertIn("models/translation/opus-mt-fr-en/manifest.json?v=browser-model-assets-v1", script)
        self.assertIn("models/Xenova/opus-mt-fr-en/config.json?v=browser-model-assets-v1", script)
        self.assertNotIn("models/translation/nllb-fr-en/manifest.json", script)
        self.assertIn("XOLOLINGUA_CLIENT_TRANSCRIBER", script)
        self.assertIn("XOLOLINGUA_CLIENT_TRANSLATOR", script)

    def test_pdm_script_exposes_real_browser_models_gate_without_deterministic_injection(self):
        pyproject = PYPROJECT.read_text(encoding="utf-8")
        match = re.search(r'^e2e-browser-real-models\s*=\s*"(?P<command>[^"]+)"$', pyproject, re.MULTILINE)

        self.assertIsNotNone(match, "pyproject should expose pdm run e2e-browser-real-models")
        command = match.group("command")
        self.assertIn("python scripts/browser_e2e_validate.py", command)
        self.assertIn("--real-browser-models", command)
        self.assertIn("--bootstrap-model-assets", command)
        self.assertIn("--require-browser-transcription", command)
        self.assertIn("--require-browser-translation", command)
        self.assertIn("--compare-backend-srt", command)
        self.assertNotIn("--inject-backend-reference-browser-ml", command)

    def test_real_browser_models_mode_rejects_deterministic_backend_reference_injection(self):
        module = self.load_module()

        with self.assertRaises(SystemExit):
            module.parse_args(["--real-browser-models", "--inject-backend-reference-browser-ml"])

    def test_real_browser_models_preflight_reports_missing_local_assets_as_actionable_skip(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = argparse.Namespace(frontend_url="http://127.0.0.1:4173")

            report = module.preflight_real_browser_model_assets(root, args)

        self.assertEqual(report["status"], "skip")
        self.assertEqual(report["missingCount"], 2)
        self.assertIn(module.REAL_MODEL_ASSET_MANIFEST_PATHS[0], report["missingLocalAssets"])
        self.assertIn("models/translation/opus-mt-fr-en/manifest.json", report["missingLocalAssets"])
        self.assertIn("Cache or provide", report["action"])

    def test_real_browser_models_preflight_rejects_remote_asset_urls_inside_local_manifests(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for manifest_path in module.REAL_MODEL_ASSET_MANIFEST_PATHS:
                local_manifest = root / manifest_path
                local_manifest.parent.mkdir(parents=True, exist_ok=True)
                local_manifest.write_text(
                    '{"assets":[{"url":"https://huggingface.co/Xenova/model.onnx","sha256":"abc123","bytes":42}]}',
                    encoding="utf-8",
                )
            args = argparse.Namespace(frontend_url="http://127.0.0.1:4173")

            report = module.preflight_real_browser_model_assets(root, args)

        self.assertEqual(report["status"], "skip")
        self.assertEqual(report["missingCount"], 0)
        self.assertIn("remote asset URLs", report["reason"])
        self.assertRegex(report["action"], r"Replace remote URLs with relative packaged asset paths")

    def test_real_browser_models_preflight_rejects_local_manifests_without_checksums(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for manifest_path in module.REAL_MODEL_ASSET_MANIFEST_PATHS:
                local_manifest = root / manifest_path
                local_manifest.parent.mkdir(parents=True, exist_ok=True)
                local_manifest.write_text(
                    '{"assets":[{"url":"weights/model.onnx","bytes":42}]}',
                    encoding="utf-8",
                )
            args = argparse.Namespace(frontend_url="http://127.0.0.1:4173")

            report = module.preflight_real_browser_model_assets(root, args)

        self.assertEqual(report["status"], "skip")
        self.assertIn("sha256 is required", report["reason"])
        self.assertRegex(report["action"], r"include sha256/bytes")

    def test_real_browser_models_preflight_rejects_assets_with_mismatched_bytes_or_sha256(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, manifest_path in enumerate(module.REAL_MODEL_ASSET_MANIFEST_PATHS):
                local_manifest = root / manifest_path
                local_manifest.parent.mkdir(parents=True, exist_ok=True)
                asset_url = f"models/Xenova/example-{index}/weights.onnx"
                asset_file = root / asset_url
                asset_file.parent.mkdir(parents=True, exist_ok=True)
                asset_file.write_text("actual asset bytes", encoding="utf-8")
                local_manifest.write_text(
                    '{"assets":[{"url":"' + asset_url + '","sha256":"not-the-digest","bytes":1}]}',
                    encoding="utf-8",
                )
            args = argparse.Namespace(frontend_url="http://127.0.0.1:4173")

            report = module.preflight_real_browser_model_assets(root, args)

        self.assertEqual(report["status"], "skip")
        self.assertIn("bytes mismatch", report["reason"])
        self.assertIn("sha256 mismatch", report["reason"])
        self.assertRegex(report["action"], r"Regenerate local model manifests")

    def test_real_browser_models_preflight_loads_all_packaged_asset_urls_from_local_manifests(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_manifest = root / "frontend" / "model_asset_manifest.js"
            app_manifest.parent.mkdir(parents=True, exist_ok=True)
            app_manifest.write_text('export const BROWSER_MODEL_ASSET_MANIFEST = Object.freeze({ version: "test-assets-v2" });', encoding="utf-8")
            for manifest_path in module.REAL_MODEL_ASSET_MANIFEST_PATHS:
                local_manifest = root / manifest_path
                local_manifest.parent.mkdir(parents=True, exist_ok=True)
                asset_url = "models/Xenova/example/weights.onnx" if "asr" in manifest_path else "models/Xenova/example/tokenizer.json"
                asset_file = root / asset_url
                asset_file.parent.mkdir(parents=True, exist_ok=True)
                asset_file.write_text("asset", encoding="utf-8")
                local_manifest.write_text(
                    '{"assets":[{"url":"' + asset_url + '","sha256":"d59386e0ae435e292fbe0ebcdb954b75ed5fb3922091277cb19f798fc5d50718","bytes":5}]}',
                    encoding="utf-8",
                )

            urls = module.load_real_model_asset_urls(root)
            report = module.preflight_real_browser_model_assets(root, argparse.Namespace(frontend_url="http://127.0.0.1:4173"))

        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["cachedCount"], 4)
        self.assertTrue(all(url.endswith("?v=test-assets-v2") for url in urls))
        self.assertIn("models/Xenova/example/weights.onnx?v=test-assets-v2", urls)
        self.assertIn("models/Xenova/example/tokenizer.json?v=test-assets-v2", urls)

    def test_compact_real_model_diagnostics_are_one_line_and_include_skip_reason(self):
        module = self.load_module()
        diagnostic = module.format_real_model_diagnostics({
            "status": "skip",
            "runtime": "chromium",
            "bootstrapStatus": "not-run",
            "cachedCount": 0,
            "missingCount": 2,
            "missingLocalAssets": [
                module.REAL_MODEL_ASSET_MANIFEST_PATHS[0],
                module.REAL_MODEL_ASSET_MANIFEST_PATHS[1],
            ],
            "warmup": {"asr": "not-run", "translation": "not-run"},
            "inference": {"asr": "not-run", "translation": "not-run"},
            "coverage": "not-run",
            "comparison": "not-run",
            "reason": "local model asset manifests are absent",
            "action": "Cache or provide local model manifests before rerunning.",
        })

        self.assertNotIn("\n", diagnostic)
        self.assertLess(len(diagnostic), 700)
        self.assertIn("status=skip", diagnostic)
        self.assertIn("bootstrap=not-run", diagnostic)
        self.assertIn("missing=2", diagnostic)
        self.assertIn("reason=local model asset manifests are absent", diagnostic)
        self.assertIn("action=Cache or provide local model manifests before rerunning.", diagnostic)


if __name__ == "__main__":
    unittest.main()
