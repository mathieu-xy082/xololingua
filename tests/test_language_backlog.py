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

    def test_missing_languages_use_expected_english_pivot_package(self):
        backlog = BACKLOG.read_text(encoding="utf-8")
        section = backlog.split("## Missing target languages", 1)[1].split("\n## ", 1)[0]

        for line in section.splitlines():
            if not line.startswith("|") or "---" in line or "Priority" in line:
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            code = cells[1]
            expected_package = cells[3].strip("`")
            self.assertEqual(expected_package, f"translate-en_{code}")


if __name__ == "__main__":
    unittest.main()
