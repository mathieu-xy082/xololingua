"""Regression checks for the target-language backlog.

These tests keep the documented missing-language list aligned with the
browser target-language catalogue while new Argos packages are validated
progressively.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "app.js"
BACKLOG = ROOT / "docs" / "missing-target-languages.md"
SOURCE_LANGUAGE = "fr"
PREPARED_TARGETS = {"ru", "uk", "zh", "de", "es", "hi", "ja", "ar"}


class TargetLanguageBacklogTests(unittest.TestCase):
    def _catalog_codes(self) -> set[str]:
        app_js = APP_JS.read_text(encoding="utf-8")
        return set(re.findall(r'\{ code: "([a-z]+)", name: "[^"]+" \}', app_js))

    def _table_codes(self, heading: str) -> set[str]:
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split(f"## {heading}", 1)[1].split("\n## ", 1)[0]
        rows = [
            [cell.strip() for cell in line.strip("|").split("|")]
            for line in section.splitlines()
            if line.startswith("|") and "---" not in line
        ]
        header = rows[0]
        code_column = header.index("Code")
        return {row[code_column] for row in rows[1:] if len(row) > code_column}

    def test_backlog_covers_every_non_source_target_language(self):
        catalog_targets = self._catalog_codes() - {SOURCE_LANGUAGE}
        documented_targets = self._table_codes("Already available for the reference French video") | self._table_codes("Missing target languages")

        self.assertSetEqual(documented_targets, catalog_targets)

    def _missing_language_rows(self) -> list[list[str]]:
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Missing target languages", 1)[1].split("\n## ", 1)[0]
        return [
            [cell.strip() for cell in line.strip("|").split("|")]
            for line in section.splitlines()
            if line.startswith("|") and "---" not in line and "Priority" not in line
        ]

    def test_missing_language_priorities_are_contiguous(self):
        priorities = [int(row[0]) for row in self._missing_language_rows()]
        expected_priorities = list(range(1, len(priorities) + 1))

        self.assertEqual(priorities, expected_priorities)

    def test_missing_languages_use_expected_english_pivot_package(self):
        for row in self._missing_language_rows():
            code = row[1]
            expected_package = row[3].strip("`")
            self.assertEqual(expected_package, f"translate-en_{code}")

    def test_prepared_targets_stay_in_backlog_until_e2e_validation(self):
        missing_codes = {row[1] for row in self._missing_language_rows()}

        self.assertLessEqual(PREPARED_TARGETS, missing_codes)

    def test_prepared_validation_rows_document_expected_packages(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Prepared package validations", 1)[1].split("\n## ", 1)[0]

        for code in PREPARED_TARGETS:
            self.assertIn(f"translate-en_{code}", section)


if __name__ == "__main__":
    unittest.main()
