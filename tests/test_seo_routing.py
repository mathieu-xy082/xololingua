"""Exercise only a temporary loopback copy of the Caddy EXAMPLE, never /etc."""
import http.client
import json
import shutil
import socket
import subprocess
import time
import unittest
from pathlib import Path

import test_web_serve as local_tests


@unittest.skipUnless(shutil.which("caddy"), "local Caddy binary is required")
class CaddyExampleRoutingTests(local_tests.StaticRoutingTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.upstream = cls.server
        cls.upstream_thread = cls.thread
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        example = Path(__file__).resolve().parents[1] / "deploy" / "Caddyfile.example"
        # Adapt the actual example, then validate/run an isolated HTTP-only copy.
        adapted = subprocess.run(
            ["caddy", "adapt", "--adapter", "caddyfile", "--config", str(example)],
            check=True, capture_output=True, text=True,
        )
        json.loads(adapted.stdout)
        text = example.read_text().replace("xololingua.example.com {", f"http://127.0.0.1:{cls.port} {{")
        text = text.replace("/srv/xololingua/www", str(cls.root))
        text = text.replace("127.0.0.1:8765", f"127.0.0.1:{cls.upstream.server_port}")
        config = cls.root / "Caddyfile.test"
        config.write_text("{\n    admin off\n    auto_https off\n    persist_config off\n}\n" + text)
        subprocess.run(
            ["caddy", "validate", "--adapter", "caddyfile", "--config", str(config)],
            check=True, capture_output=True, text=True,
        )
        cls.log = (cls.root / "caddy.log").open("w+")
        cls.process = subprocess.Popen(
            ["caddy", "run", "--adapter", "caddyfile", "--config", str(config)],
            stdout=cls.log, stderr=cls.log,
        )
        cls.addClassCleanup(cls.stop_caddy)
        for _ in range(100):
            if cls.process.poll() is not None:
                cls.log.seek(0)
                raise RuntimeError(cls.log.read())
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.03)
        else:
            raise RuntimeError("Caddy loopback startup timed out")

    @classmethod
    def stop_caddy(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()

    def request(self, target, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            # Browsers never send fragment identifiers to an HTTP server.
            connection.request(method, target.split("#", 1)[0])
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_traversal_paths_are_not_resolved_to_root_files(self):
        # Caddy normalizes dot segments, but must not expose files above root.
        for path in ("/../outside-secret", "/%2e%2e/outside-secret"):
            status, _, _ = self.request(path)
            self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
