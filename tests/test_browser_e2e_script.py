"""Checks for the browser E2E validation script wiring."""

from __future__ import annotations

import ast
import importlib.util
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
            with self.assertRaisesRegex(AssertionError, "subtitle text"):
                module.validate_srt(bad_srt, min_blocks=1)


if __name__ == "__main__":
    unittest.main()
