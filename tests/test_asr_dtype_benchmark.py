"""Unit tests for the WebGPU ASR dtype benchmark."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPTS / "asr_dtype_benchmark.py"


def load_module():
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location("asr_dtype_benchmark", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS))


class AsrDtypeBenchmarkTests(unittest.TestCase):
    def test_text_similarity_is_case_and_order_tolerant_but_detects_missing_words(self):
        module = load_module()

        self.assertEqual(module.text_similarity("Bonjour le monde", "MONDE bonjour le"), 1.0)
        self.assertLess(module.text_similarity("Bonjour le monde", "Bonjour"), 1.0)

    def test_ranking_excludes_quality_regressions_and_sorts_by_inference_time(self):
        module = load_module()
        results = [
            {"dtype": "fp16", "status": "ok", "text": "un deux trois quatre", "timings": {"inferenceMs": 2000, "realtimeFactor": 0.07}},
            {"dtype": "q4f16", "status": "ok", "text": "un deux trois quatre", "timings": {"inferenceMs": 1200, "realtimeFactor": 0.04}},
            {"dtype": "q4", "status": "ok", "text": "texte incorrect", "timings": {"inferenceMs": 800, "realtimeFactor": 0.03}},
        ]

        ranking = module.rank_results(results)

        self.assertEqual([row["dtype"] for row in ranking], ["q4f16", "fp16"])
        self.assertEqual(results[2]["similarityToReference"], 0.0)


if __name__ == "__main__":
    unittest.main()
