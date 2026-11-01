import importlib.util
import functools
import http.client
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
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

    def test_webgpu_browser_command_uses_isolated_profile_and_flags(self):
        module = load_module()
        command = module.build_webgpu_browser_command(
            "/opt/brave.com/brave-nightly/brave",
            Path("/tmp/xololingua-test-profile"),
            "http://127.0.0.1:4173",
        )
        self.assertEqual(command[0], "/opt/brave.com/brave-nightly/brave")
        self.assertIn("--user-data-dir=/tmp/xololingua-test-profile", command)
        self.assertIn("--enable-features=Vulkan", command)
        self.assertIn("--use-angle=vulkan", command)
        self.assertIn("--enable-unsafe-webgpu", command)


SEO_ROUTES = (
    "/generateur-sous-titres-video",
    "/traduire-sous-titres-srt",
    "/sous-titres-youtube",
    "/en/video-subtitle-generator",
    "/en/translate-srt-subtitles",
    "/en/youtube-subtitles",
)


class StaticRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory(prefix="xolo-routing-")
        cls.addClassCleanup(cls.fixture.cleanup)
        cls.root = Path(cls.fixture.name)
        for route in SEO_ROUTES:
            target = cls.root / (route.lstrip("/") + ".html")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("guide:" + route)
        (cls.root / "index.html").write_text("ROOT APPLICATION")
        (cls.root / "other.html").write_text("OTHER FILE")
        module = load_module()
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            functools.partial(module.XoloLinguaStaticHandler, directory=str(cls.root)),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.thread.join)
        cls.addClassCleanup(cls.server.shutdown)

    def request(self, target, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, target)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_six_canonical_routes_serve_only_their_built_files(self):
        for route in SEO_ROUTES:
            for suffix in ("", "?lang=fr&next=%2Fapp#ignored"):
                with self.subTest(route=route, suffix=suffix):
                    status, headers, body = self.request(route + suffix)
                    self.assertEqual(status, 200)
                    self.assertEqual(body.decode(), "guide:" + route)
                    self.assertEqual(headers["Cross-Origin-Opener-Policy"], "same-origin")
                    self.assertEqual(headers["Cross-Origin-Embedder-Policy"], "require-corp")


    def test_aliases_redirect_permanently_with_query_but_without_fragment(self):
        for route in SEO_ROUTES:
            for alias in (route + ".html", route + "/"):
                for suffix in ("", "?utm_source=a&next=%2Fapp&x=%0D%0AX-Test%3Ayes#ignored"):
                    with self.subTest(alias=alias, suffix=suffix):
                        status, headers, body = self.request(alias + suffix)
                        self.assertIn(status, (301, 308))
                        self.assertEqual(headers["Location"], route + suffix.split("#", 1)[0])
                        self.assertEqual(body, b"")

    def test_unknown_paths_do_not_fall_back_or_infer_html(self):
        for path in ("/missing", "/other", "/en/missing", SEO_ROUTES[0] + "/child", "/api/missing"):
            with self.subTest(path=path):
                status, _, _ = self.request(path)
                self.assertEqual(status, 404)

    def test_root_existing_files_and_api_are_unchanged(self):
        (self.root / "api").mkdir(exist_ok=True)
        (self.root / "api" / "probe").write_text("API UNCHANGED")
        for path, content in (("/", b"ROOT APPLICATION"), ("/other.html", b"OTHER FILE"), ("/api/probe?x=1", b"API UNCHANGED")):
            status, _, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(body, content)

    def test_traversal_paths_are_not_resolved_to_root_files(self):
        for path in ("/../index.html", "/%2e%2e/index.html", "/en/../index.html", "/en/%2e%2e%2findex.html"):
            with self.subTest(path=path):
                status, _, _ = self.request(path)
                self.assertEqual(status, 404)

    def test_head_uses_the_same_canonical_and_alias_routing(self):
        for route in SEO_ROUTES:
            status, _, body = self.request(route, "HEAD")
            self.assertEqual(status, 200)
            self.assertEqual(body, b"")
            status, headers, body = self.request(route + ".html?x=1", "HEAD")
            self.assertIn(status, (301, 308))
            self.assertEqual(headers["Location"], route + "?x=1")
            self.assertEqual(body, b"")


class SourceRoutingTests(StaticRoutingTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for route in SEO_ROUTES:
            built = cls.root / (route.lstrip("/") + ".html")
            source = cls.root / "seo" / built.relative_to(cls.root)
            source.parent.mkdir(parents=True, exist_ok=True)
            built.rename(source)
        # Files outside the whitelist must not gain extensionless routes.
        (cls.root / "seo" / "other.html").write_text("NOT A ROUTE")
        (cls.root / "seo" / "en" / "missing.html").write_text("NOT A ROUTE")

    def test_source_aliases_resolve_to_guides_for_get_and_head(self):
        for route in SEO_ROUTES:
            for method in ("GET", "HEAD"):
                for alias in (route + ".html", route + "/"):
                    with self.subTest(route=route, method=method, alias=alias):
                        status, headers, body = self.request(alias + "?x=1#ignored", method)
                        self.assertEqual(status, 308)
                        self.assertEqual(headers["Location"], route + "?x=1")
                        self.assertEqual(body, b"")
                        status, headers, body = self.request(headers["Location"], method)
                        self.assertEqual(status, 200)
                        expected = ("guide:" + route).encode()
                        self.assertEqual(int(headers["Content-Length"]), len(expected))
                        self.assertEqual(body, expected if method == "GET" else b"")

    def test_missing_whitelisted_source_file_still_returns_404(self):
        source = self.root / "seo" / (SEO_ROUTES[0].lstrip("/") + ".html")
        content = source.read_bytes()
        source.unlink()
        try:
            for method in ("GET", "HEAD"):
                status, _, _ = self.request(SEO_ROUTES[0] + "?x=1", method)
                self.assertEqual(status, 404)
        finally:
            source.write_bytes(content)


class BuiltPreferenceRoutingTests(StaticRoutingTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for route in SEO_ROUTES:
            source = cls.root / "seo" / (route.lstrip("/") + ".html")
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("SOURCE MUST NOT OVERRIDE BUILT:" + route)


if __name__ == "__main__":
    unittest.main()
