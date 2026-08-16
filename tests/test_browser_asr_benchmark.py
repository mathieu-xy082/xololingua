"""Checks for the isolated browser ASR benchmark."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "browser_asr_benchmark.py"


def load_module():
    spec = importlib.util.spec_from_file_location("browser_asr_benchmark", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BrowserAsrBenchmarkTests(unittest.TestCase):
    def test_requires_at_least_two_minutes(self):
        module = load_module()
        with self.assertRaises(SystemExit):
            module.parse_args(["--duration-seconds", "119.9"])
        self.assertEqual(module.parse_args(["--duration-seconds", "120"]).duration_seconds, 120)

    def test_memory_safe_order_is_the_default(self):
        module = load_module()
        self.assertEqual(module.parse_args([]).order, "vad-segments-first")

    def test_ffmpeg_extracts_continuous_mono_16khz_pcm(self):
        module = load_module()
        command = module.build_ffmpeg_command(Path("source.mp4"), Path("excerpt.wav"), 12.5, 120)
        self.assertEqual(command[:2], ["ffmpeg", "-hide_banner"])
        self.assertIn("12.500", command)
        self.assertIn("120.000", command)
        self.assertEqual(command[-8:], ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "excerpt.wav"])

    def test_summary_compares_same_mode_results(self):
        module = load_module()
        report = {
            "results": {
                "long-form": {
                    "benchmarkWallMs": 42_000,
                    "segments": [{"text": "Bonjour le monde"}],
                    "metadata": {"timings": {"inferenceMs": 40_000, "realtimeFactor": 0.333, "audioSeconds": 120}},
                },
                "vad-segments": {
                    "benchmarkWallMs": 80_000,
                    "segments": [{"text": "Bonjour le monde !"}],
                    "metadata": {"timings": {"inferenceMs": 80_000, "realtimeFactor": 0.8, "audioSeconds": 100}},
                },
            }
        }
        summary = module.summarize_report(report)
        self.assertEqual(summary["longFormSpeedupVsVad"], 2.0)
        self.assertEqual(summary["transcriptSimilarity"], 1.0)
        self.assertEqual(summary["modes"]["long-form"]["wordCount"], 3)
        self.assertEqual(summary["modes"]["long-form"]["segmentsPastAudioEnd"], 0)

    def test_browser_code_disposes_and_terminates_worker_in_finally(self):
        module = load_module()
        self.assertIn('send(\n            "dispose"', module.BROWSER_BENCHMARK)
        self.assertIn("worker.terminate()", module.BROWSER_BENCHMARK)
        self.assertIn("finally", module.BROWSER_BENCHMARK)

    def test_pdm_exposes_benchmark_command(self):
        pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('benchmark-browser-asr = "python scripts/browser_asr_benchmark.py"', pyproject)


if __name__ == "__main__":
    unittest.main()
