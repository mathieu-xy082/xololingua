"""Checks for the API E2E validation script wiring."""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "api_e2e_validate.py"
PYPROJECT = ROOT / "pyproject.toml"


class ApiE2EScriptTests(unittest.TestCase):
    def test_api_e2e_script_exists_and_exposes_validation_helpers(self):
        self.assertTrue(SCRIPT.is_file(), "scripts/api_e2e_validate.py should exist")
        module = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        functions = {node.name for node in module.body if isinstance(node, ast.FunctionDef)}
        self.assertIn("main", functions)
        self.assertIn("format_srt", functions)
        self.assertIn("validate_srt", functions)
        self.assertIn("run_api_workflow", functions)

    def test_pdm_script_runs_api_e2e_validator(self):
        pyproject = PYPROJECT.read_text(encoding="utf-8")
        self.assertIn('api-e2e = "python scripts/api_e2e_validate.py"', pyproject)

    def test_api_e2e_validator_rejects_non_srt_artifacts(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("api_e2e_validate", SCRIPT)
        self.assertIsNotNone(spec)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        self.assertIsNotNone(spec.loader)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as directory:
            bad_srt = Path(directory) / "bad.srt"
            bad_srt.write_text("not a subtitle", encoding="utf-8")
            with self.assertRaises(AssertionError):
                module.validate_srt(bad_srt, min_blocks=1)

    @unittest.skipUnless(
        os.environ.get("XOLOLINGUA_VALIDATE_API_E2E") == "1",
        "set XOLOLINGUA_VALIDATE_API_E2E=1 to run the slow real video API E2E validation",
    )
    def test_api_e2e_real_video_opt_in(self):
        target = os.environ.get("XOLOLINGUA_API_E2E_TARGET", "en")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--target", target],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=1800,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("API E2E succeeded", result.stdout)


if __name__ == "__main__":
    unittest.main()
