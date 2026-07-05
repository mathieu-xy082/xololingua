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

    def test_current_package_index_blockers_keep_unavailable_languages_missing(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("| 2026-07-04 | mr, te, ta |", text)
        self.assertIn("`translate-en_mr`, `translate-en_te`, `translate-en_ta`", text)
        self.assertIn("`fr -> mr`, `fr -> te`, and `fr -> ta` remain blocked", text)

        missing_section = re.search(
            r"## Missing target languages\n\n(?P<table>.*?)(?:\n\n## |\Z)",
            text,
            re.S,
        )
        self.assertIsNotNone(missing_section)
        assert missing_section is not None
        for code in ("mr", "te", "ta"):
            self.assertRegex(missing_section.group("table"), rf"\|\s*\d+\s*\|\s*{code}\s*\|")

    def test_validation_checklist_names_api_e2e_as_removal_gate(self):
        text = DOC.read_text(encoding="utf-8")
        checklist = text.split("## Validation checklist for each language", 1)[1]

        self.assertIn("Run the API E2E server workflow", checklist)
        self.assertIn("verified non-empty `.srt`", checklist)
        self.assertIn("Remove the validated language", checklist)
        self.assertNotIn("Load `/root/android-app-games/resources/lisoir_dnde442.mp4` through the browser workflow", checklist)
        self.assertNotIn("Remove the validated language from this file", checklist)

    def test_prepared_package_notes_do_not_name_browser_as_language_removal_gate(self):
        text = DOC.read_text(encoding="utf-8")
        prepared_section = text.split("## Prepared package validations", 1)[1].split("## API E2E video validations", 1)[0]

        self.assertIn("API E2E", prepared_section)
        self.assertNotIn("full browser video workflow generates and verifies a `.srt`", prepared_section)

    def test_recorded_api_e2e_artifacts_use_cache_directory_not_repo_tmp(self):
        text = DOC.read_text(encoding="utf-8")
        api_section = text.split("## API E2E video validations", 1)[1].split("## Representative browser-download validations", 1)[0]

        self.assertIn("~/.cache/xololingua/e2e-validations/", api_section)
        self.assertNotIn("tmp/e2e-validations/", api_section)


if __name__ == "__main__":
    unittest.main()
