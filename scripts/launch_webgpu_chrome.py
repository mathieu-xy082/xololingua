#!/usr/bin/env python3
"""Launch XoloLingua in an isolated Chrome profile with Linux WebGPU enabled."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable


DEFAULT_URL = "http://127.0.0.1:4173"
DEFAULT_PROFILE = Path.home() / ".cache" / "xololingua" / "chrome-webgpu-profile"
CHROME_CANDIDATES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--chrome", help="Explicit Chrome/Chromium executable.")
    return parser.parse_args(argv)


def find_chrome(explicit: str | None = None) -> str:
    if explicit:
        resolved = shutil.which(explicit) or (explicit if Path(explicit).is_file() else None)
        if resolved:
            return str(resolved)
        raise RuntimeError(f"Chrome executable not found: {explicit}")
    for candidate in CHROME_CANDIDATES:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("Chrome/Chromium was not found on PATH.")


def build_chrome_command(chrome: str, profile: Path, url: str) -> list[str]:
    return [
        chrome,
        f"--user-data-dir={profile}",
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--enable-features=Vulkan",
        url,
    ]


def frontend_is_available(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2.0) as response:
            return 200 <= response.status < 400
    except (OSError, urllib.error.URLError):
        return False


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not frontend_is_available(args.url):
        raise SystemExit(f"XoloLingua frontend is not reachable at {args.url}. Start it first with: pdm run web")

    chrome = find_chrome(args.chrome)
    args.profile.mkdir(parents=True, exist_ok=True)
    command = build_chrome_command(chrome, args.profile.resolve(), args.url)
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    print(f"Launched Chrome WebGPU for XoloLingua (PID {process.pid}).", flush=True)
    print("The model panel will report WebGPU or the exact WASM fallback reason.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
