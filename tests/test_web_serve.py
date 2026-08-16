import importlib.util
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "web_serve.py"


def load_module():
    spec = importlib.util.spec_from_file_location("web_serve", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class WebServeTests(unittest.TestCase):
    def test_web_server_opens_the_system_default_browser_by_default(self):
        module = load_module()
        args = module.parse_args([])

        self.assertFalse(args.no_browser)
        with mock.patch.object(module.webbrowser, "open", return_value=True) as open_browser:
            self.assertTrue(module.open_default_browser("http://127.0.0.1:4173"))
        open_browser.assert_called_once_with("http://127.0.0.1:4173", new=2)

    def test_no_browser_is_available_for_automation(self):
        module = load_module()
        args = module.parse_args(["--no-browser"])

        self.assertTrue(args.no_browser)

    def test_wildcard_bind_address_opens_a_local_browser_url(self):
        module = load_module()

        self.assertEqual(module.frontend_url("0.0.0.0", 4173), "http://127.0.0.1:4173")


if __name__ == "__main__":
    unittest.main()
