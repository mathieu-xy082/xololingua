"""Unit tests for the structural WebGPU ASR batching benchmark."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPTS / "asr_batching_benchmark.py"


def load_module():
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location("asr_batching_benchmark", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS))


class AsrBatchingBenchmarkTests(unittest.TestCase):
    def test_acceptance_requires_quality_alignment_speedup_and_no_fallback(self):
        module = load_module()
        result = {
            "sequential": {
                "text": "bonjour le monde",
                "metadata": {"timings": {"inferenceMs": 1000}},
            },
            "batched": {
                "text": "bonjour le monde",
                "metadata": {
                    "executionDevice": "webgpu",
                    "timings": {
                        "inferenceMs": 700,
                        "batchMode": "internal-adaptive",
                        "mode": "webgpu-internal-batch",
                        "wordAssignmentRatio": 0.99,
                    },
                },
            },
        }

        acceptance = module.evaluate_acceptance(result)

        self.assertTrue(acceptance["passed"])
        self.assertEqual(acceptance["speedupRatio"], 0.3)
        result["batched"]["metadata"]["timings"]["mode"] = "webgpu-sequential-fallback"
        self.assertFalse(module.evaluate_acceptance(result)["passed"])

    def test_batch_size_is_explicitly_limited_to_supported_probe_values(self):
        module = load_module()

        self.assertEqual(module.parse_args(["--video", "sample.mp4"]).batch_size, 2)
        self.assertEqual(module.parse_args(["--video", "sample.mp4", "--batch-size", "4"]).batch_size, 4)


if __name__ == "__main__":
    unittest.main()
