#!/usr/bin/env python3
"""Serve the XoloLingua PWA with headers required by ffmpeg.wasm.

ffmpeg.wasm uses SharedArrayBuffer in Chromium, which requires a cross-origin
isolated page. The browser E2E and local development server must therefore set
COOP/COEP headers instead of using bare `python -m http.server`.
"""

from __future__ import annotations

import argparse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4173


class XoloLinguaStaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--directory", type=Path, default=ROOT)
    parser.add_argument("--no-browser", action="store_true", help="Do not open the frontend in the system default browser.")
    return parser.parse_args(argv)


def frontend_url(host: str, port: int) -> str:
    browser_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    return f"http://{browser_host}:{port}"


def open_default_browser(url: str) -> bool:
    return bool(webbrowser.open(url, new=2))


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    handler = lambda *handler_args, **handler_kwargs: XoloLinguaStaticHandler(
        *handler_args,
        directory=str(args.directory),
        **handler_kwargs,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = frontend_url(args.host, args.port)
    print(f"Serving XoloLingua PWA on {url} from {args.directory}", flush=True)
    if not args.no_browser:
        if open_default_browser(url):
            print("Opened XoloLingua in the system default browser.", flush=True)
        else:
            print(f"Could not open the system default browser; open {url} manually.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
