"""Regression checks for target-language validation backlog notes."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "missing-target-languages.md"


class MissingTargetLanguageDocsTests(unittest.TestCase):
    def assert_api_e2e_language_is_available_not_missing(self, code: str, language: str, date: str) -> None:
        text = DOC.read_text(encoding="utf-8")

        self.assertIn(f"| {date} | {code} | `pdm run api-e2e --target {code}", text)
        self.assertIn(f"| {code} | {language} | API E2E generated and verified", text)

        missing_section = re.search(
            r"## Missing target languages\n\n(?P<table>.*?)(?:\n\n## |\Z)",
            text,
            re.S,
        )
        self.assertIsNotNone(missing_section)
        assert missing_section is not None
        self.assertNotRegex(missing_section.group("table"), rf"\|\s*\d+\s*\|\s*{code}\s*\|")

    def test_zh_api_e2e_validation_is_recorded_as_available_not_missing(self):
        self.assert_api_e2e_language_is_available_not_missing("zh", "Chinese", "2026-07-01")

    def test_ur_api_e2e_validation_is_recorded_as_available_not_missing(self):
        self.assert_api_e2e_language_is_available_not_missing("ur", "Urdu", "2026-07-03")

    def test_it_api_e2e_validation_is_recorded_as_available_not_missing(self):
        self.assert_api_e2e_language_is_available_not_missing("it", "Italian", "2026-07-04")


if __name__ == "__main__":
    unittest.main()
