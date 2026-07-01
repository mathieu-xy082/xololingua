"""Regression checks for target-language validation backlog notes."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "missing-target-languages.md"


class MissingTargetLanguageDocsTests(unittest.TestCase):
    def test_zh_api_e2e_validation_is_recorded_as_available_not_missing(self):
        text = DOC.read_text(encoding="utf-8")

        self.assertIn("| 2026-07-01 | zh | `pdm run api-e2e --target zh` |", text)
        self.assertIn("| zh | Chinese | API E2E generated and verified", text)

        missing_section = re.search(
            r"## Missing target languages\n\n(?P<table>.*?)(?:\n\n## |\Z)",
            text,
            re.S,
        )
        self.assertIsNotNone(missing_section)
        assert missing_section is not None
        self.assertNotRegex(missing_section.group("table"), r"\|\s*\d+\s*\|\s*zh\s*\|")


if __name__ == "__main__":
    unittest.main()
