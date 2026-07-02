"""Regression checks for the target-language backlog.

These tests keep the documented missing-language list aligned with the
browser target-language catalogue while new Argos packages are validated
progressively.
"""

from __future__ import annotations

import os
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "app.js"
BACKLOG = ROOT / "docs" / "missing-target-languages.md"
SOURCE_LANGUAGE = "fr"
PREPARED_TARGETS = {
    "ru",
    "uk",
    "zh",
    "de",
    "es",
    "hi",
    "ja",
    "ar",
    "bn",
    "pt",
    "ur",
    "id",
    "sw",
    "tr",
    "it",
}
API_E2E_VALIDATED_TARGETS = {
    "ru",
    "uk",
    "zh",
    "de",
    "es",
    "hi",
    "ja",
    "ar",
}
PACKAGE_INDEX_BLOCKED_TARGETS = {
    "mr",
    "te",
    "ta",
}
LATEST_PRIORITY_BATCH = ["sw", "mr", "te", "tr", "ta", "it"]
LATEST_PRIORITY_AVAILABLE_TARGETS = {"sw", "tr", "it"}
LATEST_PRIORITY_PACKAGE_INDEX_BLOCKED_TARGETS = {"mr", "te", "ta"}
TRANSLATOR_SMOKE_TARGETS = {
    "ru",
    "uk",
    "zh",
    "de",
    "es",
    "hi",
    "ja",
    "ar",
    "bn",
    "pt",
    "ur",
    "id",
    "sw",
    "tr",
    "it",
}
LOCAL_ARGOS_VALIDATION_ENV = "XOLOLINGUA_VALIDATE_LOCAL_ARGOS"


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

        self.assertLessEqual(PREPARED_TARGETS - API_E2E_VALIDATED_TARGETS, missing_codes)
        self.assertTrue(API_E2E_VALIDATED_TARGETS.isdisjoint(missing_codes))

    def test_prepared_validation_rows_document_expected_packages(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Prepared package validations", 1)[1].split("\n## ", 1)[0]

        for code in PREPARED_TARGETS:
            self.assertIn(f"translate-en_{code}", section)

    def test_package_index_blockers_stay_in_backlog_until_package_exists(self):
        missing_codes = {row[1] for row in self._missing_language_rows()}

        self.assertLessEqual(PACKAGE_INDEX_BLOCKED_TARGETS, missing_codes)

    def test_package_index_blockers_document_expected_packages(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Package-index blockers", 1)[1].split("\n## ", 1)[0]

        for code in PACKAGE_INDEX_BLOCKED_TARGETS:
            self.assertIn(f"translate-en_{code}", section)

    def test_latest_priority_batch_documents_package_state(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Latest priority-batch probe", 1)[1].split("\n## ", 1)[0]

        for code in LATEST_PRIORITY_BATCH:
            self.assertIn(f"translate-en_{code}", section)

        for code in LATEST_PRIORITY_AVAILABLE_TARGETS:
            self.assertIn(f"en -> {code}", section)
            self.assertIn(f"fr -> {code}", section)

        for code in LATEST_PRIORITY_PACKAGE_INDEX_BLOCKED_TARGETS:
            self.assertIn(f"translate-en_{code}", section)
            self.assertIn(f"fr -> {code}", section)
            self.assertIn("remain blocked locally", section)

        self.assertIn("The package index exposes `translate-en_sw`, `translate-en_tr`, and `translate-en_it`", section)

    def test_translator_smoke_validations_document_expected_packages(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Translator smoke validations", 1)[1].split("\n## ", 1)[0]

        for code in TRANSLATOR_SMOKE_TARGETS:
            self.assertIn(f"translate-en_{code}", section)
            self.assertIn(f"fr -> {code}", section)

    @unittest.skipUnless(
        os.environ.get(LOCAL_ARGOS_VALIDATION_ENV) == "1",
        f"set {LOCAL_ARGOS_VALIDATION_ENV}=1 to check locally installed Argos packages",
    )
    def test_first_priority_batch_is_exposed_by_local_argos_when_enabled(self):
        from xololingua_service import translation

        pairs = {
            (pair["source"], pair["target"])
            for pair in translation.get_supported_pairs()
        }

        for code in LATEST_PRIORITY_AVAILABLE_TARGETS:
            with self.subTest(code=code):
                self.assertIn(("en", code), pairs)
                self.assertIn(("fr", code), pairs)

        for code in LATEST_PRIORITY_PACKAGE_INDEX_BLOCKED_TARGETS:
            with self.subTest(code=code):
                self.assertNotIn(("en", code), pairs)
                self.assertNotIn(("fr", code), pairs)

    @unittest.skipUnless(
        os.environ.get(LOCAL_ARGOS_VALIDATION_ENV) == "1",
        f"set {LOCAL_ARGOS_VALIDATION_ENV}=1 to smoke-test locally installed Argos translators",
    )
    def test_smoke_validated_priority_targets_translate_through_english_pivot_when_enabled(self):
        from xololingua_service import translation

        source_text = "Bonjour tout le monde."
        for code in sorted(TRANSLATOR_SMOKE_TARGETS):
            with self.subTest(code=code):
                translated = translation.translate_text(source_text, "fr", code)

                self.assertTrue(translated.strip())
                self.assertNotEqual(translated, source_text)

if __name__ == "__main__":
    unittest.main()
