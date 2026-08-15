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
        self.assertIn("log_step", functions)

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

    def test_backend_reference_injection_only_installs_deterministic_adapters(self):
        module = self.load_module()

        script = module.create_backend_reference_init_script({"translatedSegments": []})

        self.assertNotIn("__xololinguaCachedModelAssetUrls", script)
        self.assertNotIn("models/Xenova", script)
        self.assertIn("XOLOLINGUA_CLIENT_TRANSCRIBER", script)
        self.assertIn("XOLOLINGUA_CLIENT_TRANSLATOR", script)

    def test_pdm_script_exposes_real_browser_models_gate_without_deterministic_injection(self):
        pyproject = PYPROJECT.read_text(encoding="utf-8")
        match = re.search(r'^e2e-browser-real-models\s*=\s*"(?P<command>[^"]+)"$', pyproject, re.MULTILINE)

        self.assertIsNotNone(match, "pyproject should expose pdm run e2e-browser-real-models")
        command = match.group("command")
        self.assertIn("python scripts/browser_e2e_validate.py", command)
        self.assertIn("--real-browser-models", command)
        self.assertNotIn("--bootstrap-model-assets", command)
        self.assertIn("--source fr", command)
        self.assertIn("--target ru", command)
        self.assertIn("--require-browser-transcription", command)
        self.assertIn("--require-browser-translation", command)
        self.assertIn("--compare-backend-srt", command)
        self.assertNotIn("--inject-backend-reference-browser-ml", command)

    def test_real_browser_models_mode_rejects_deterministic_backend_reference_injection(self):
        module = self.load_module()

        with self.assertRaises(SystemExit):
            module.parse_args(["--real-browser-models", "--inject-backend-reference-browser-ml"])

    def test_dynamic_model_ids_are_derived_from_source_and_target(self):
        module = self.load_module()

        self.assertEqual(
            module.dynamic_model_ids("FR", "RU"),
            ["Xenova/whisper-base", "Xenova/opus-mt-fr-ru"],
        )

    def test_dynamic_model_request_matching_accepts_hugging_face_urls(self):
        module = self.load_module()
        model_ids = module.dynamic_model_ids("fr", "ru")

        self.assertEqual(
            module.match_dynamic_model_id(
                "https://huggingface.co/Xenova/opus-mt-fr-ru/resolve/main/onnx/model_quantized.onnx",
                model_ids,
            ),
            "Xenova/opus-mt-fr-ru",
        )
        self.assertIsNone(
            module.match_dynamic_model_id("http://127.0.0.1:4173/models/Xenova/opus-mt-fr-ru/config.json", model_ids)
        )

    def test_dynamic_model_network_requires_each_model_without_failures_or_local_urls(self):
        module = self.load_module()
        model_ids = module.dynamic_model_ids("fr", "ru")

        module.validate_dynamic_model_network(model_ids, model_ids, [], [])
        with self.assertRaisesRegex(AssertionError, "opus-mt-fr-ru"):
            module.validate_dynamic_model_network(model_ids, [model_ids[0]], [], [])
        with self.assertRaisesRegex(AssertionError, "downloads failed"):
            module.validate_dynamic_model_network(
                model_ids,
                model_ids,
                [{"status": 404, "url": "https://huggingface.co/Xenova/whisper-base/missing"}],
                [],
            )
        with self.assertRaisesRegex(AssertionError, "Legacy local model URLs"):
            module.validate_dynamic_model_network(
                model_ids,
                model_ids,
                [],
                ["http://127.0.0.1:4173/models/Xenova/whisper-base/config.json"],
            )

    def test_dynamic_model_cache_inspection_delegates_expected_model_ids(self):
        module = self.load_module()
        model_ids = module.dynamic_model_ids("fr", "ru")

        page = mock.Mock()
        page.evaluate.return_value = {
            "cacheAvailable": True,
            "matchingEntries": [],
            "cachePurged": True,
        }

        report = module.inspect_dynamic_model_cache_in_page(page, model_ids)

        self.assertTrue(report["cachePurged"])
        self.assertEqual(page.evaluate.call_args.args[1], model_ids)

    def test_chromium_http_cache_inspection_reports_retained_bytes(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)
            cache = profile / "Default" / "Cache" / "Cache_Data"
            cache.mkdir(parents=True)
            (cache / "entry-a").write_bytes(b"a" * 7)
            (cache / "entry-b").write_bytes(b"b" * 11)

            report = module.inspect_chromium_http_cache(profile)

        self.assertEqual(report["files"], 2)
        self.assertEqual(report["bytes"], 18)

    def test_compact_real_model_diagnostics_are_one_line_and_include_lifecycle_result(self):
        module = self.load_module()
        diagnostic = module.format_real_model_diagnostics({
            "status": "pass",
            "runtime": "chromium",
            "modelIds": ["Xenova/whisper-base", "Xenova/opus-mt-fr-ru"],
            "downloadedRequests": 23,
            "failedRequests": 0,
            "cachePurged": True,
            "remainingCacheEntries": 0,
            "uiLifecycle": "purged",
            "httpCacheBytes": 12_345,
            "warmup": {"asr": "pass", "translation": "pass"},
            "inference": {"asr": "pass", "translation": "pass"},
            "coverage": "pass",
            "comparison": "pass",
            "reason": "on-demand browser model lifecycle completed",
            "action": "none",
        })

        self.assertNotIn("\n", diagnostic)
        self.assertLess(len(diagnostic), 700)
        self.assertIn("status=pass", diagnostic)
        self.assertIn("models=Xenova/whisper-base,Xenova/opus-mt-fr-ru", diagnostic)
        self.assertIn("downloads=23", diagnostic)
        self.assertIn("cachePurged=true", diagnostic)
        self.assertIn("remainingCacheEntries=0", diagnostic)
        self.assertIn("uiLifecycle=purged", diagnostic)
        self.assertIn("httpCacheBytes=12345", diagnostic)


if __name__ == "__main__":
    unittest.main()
