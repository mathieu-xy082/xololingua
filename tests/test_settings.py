"""Configuration checks for generated artifact locations."""

from __future__ import annotations

import importlib
import os
import unittest
from pathlib import Path
from unittest import mock

from xololingua_service import settings


class SettingsTests(unittest.TestCase):
    def reload_settings_with_env(self, **env: str):
        with mock.patch.dict(os.environ, env, clear=False):
            return importlib.reload(settings)

    def tearDown(self) -> None:
        importlib.reload(settings)

    def test_default_work_dir_uses_cache_tmp_root_outside_repository(self):
        module = self.reload_settings_with_env()

        self.assertEqual(
            module.WORK_DIR,
            Path.home() / ".cache" / "xololingua" / "tmp" / "service",
        )
        self.assertNotIn(module.PROJECT_ROOT, module.WORK_DIR.parents)

    def test_xololingua_tmp_dir_overrides_service_work_dir_root(self):
        override = Path.home() / ".cache" / "xololingua-test" / "tmp"
        module = self.reload_settings_with_env(XOLOLINGUA_TMP_DIR=str(override))

        self.assertEqual(module.WORK_DIR, override / "service")


if __name__ == "__main__":
    unittest.main()
