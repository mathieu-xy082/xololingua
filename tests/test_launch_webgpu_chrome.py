import importlib.util
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "launch_webgpu_chrome.py"


def load_module():
    spec = importlib.util.spec_from_file_location("launch_webgpu_chrome", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LaunchWebGpuChromeTests(unittest.TestCase):
    def test_command_uses_isolated_profile_and_required_linux_webgpu_flags(self):
        module = load_module()
        command = module.build_chrome_command(
            "/usr/bin/google-chrome",
            Path("/tmp/xololingua-webgpu-profile"),
            "http://127.0.0.1:4173",
        )

        self.assertEqual(command[0], "/usr/bin/google-chrome")
        self.assertIn("--user-data-dir=/tmp/xololingua-webgpu-profile", command)
        self.assertIn("--enable-unsafe-webgpu", command)
        self.assertIn("--ignore-gpu-blocklist", command)
        self.assertIn("--enable-features=Vulkan", command)
        self.assertEqual(command[-1], "http://127.0.0.1:4173")

    def test_launcher_requires_the_frontend_before_opening_chrome(self):
        module = load_module()
        with mock.patch.object(module, "frontend_is_available", return_value=False):
            with self.assertRaisesRegex(SystemExit, "pdm run web"):
                module.main([])


if __name__ == "__main__":
    unittest.main()
