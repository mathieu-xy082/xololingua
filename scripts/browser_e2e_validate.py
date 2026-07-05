#!/usr/bin/env python3
"""Run the real browser E2E workflow and verify the downloaded SRT.

This script validates XoloLingua as a user would:
open the app, upload an MP4, identify the source language, choose a target,
segment audio, generate subtitles, capture the browser download, and inspect
its SRT content.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import suppress
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path("/root/android-app-games/resources/lisoir_dnde442.mp4")
DEFAULT_FRONTEND_URL = "http://127.0.0.1:4173"
DEFAULT_SERVICE_URL = "http://127.0.0.1:8765"
DEFAULT_DOWNLOAD_DIR = Path(
    os.environ.get(
        "XOLOLINGUA_BROWSER_E2E_DOWNLOAD_DIR",
        Path.home() / ".cache" / "xololingua" / "browser-e2e-downloads",
    )
)


class ManagedProcess:
    def __init__(self, name: str, command: list[str], cwd: Path):
        self.name = name
        self.command = command
        self.cwd = cwd
        self.process: subprocess.Popen[str] | None = None

    def start(self) -> None:
        self.process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

    def stop(self) -> None:
        if self.process is None or self.process.poll() is not None:
            return
        self.process.terminate()
        with suppress(subprocess.TimeoutExpired):
            self.process.wait(timeout=10)
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)

    def tail_output(self, max_chars: int = 2000) -> str:
        if self.process is None or self.process.stdout is None:
            return ""
        with suppress(Exception):
            return self.process.stdout.read()[-max_chars:]
        return ""


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO, help="MP4 video used as the real E2E fixture.")
    parser.add_argument("--target", default="en", help="Target language code selected in the UI.")
    parser.add_argument("--expected-source-label", default="French", help="Expected source language label shown by the UI.")
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL, help="URL of the static frontend.")
    parser.add_argument("--service-url", default=DEFAULT_SERVICE_URL, help="URL of the local backend service.")
    parser.add_argument("--download-dir", type=Path, default=DEFAULT_DOWNLOAD_DIR, help="Directory where the downloaded .srt is saved.")
    parser.add_argument("--keep-servers", action="store_true", help="Leave auto-started service/web processes running.")
    parser.add_argument("--no-start", action="store_true", help="Do not auto-start PDM service/web; require them to be already reachable.")
    parser.add_argument("--headed", action="store_true", help="Run Chromium headed for debugging.")
    parser.add_argument("--slow-mo-ms", type=int, default=0, help="Playwright slow_mo in milliseconds.")
    parser.add_argument("--language-timeout-ms", type=int, default=240_000)
    parser.add_argument("--segmentation-timeout-ms", type=int, default=240_000)
    parser.add_argument("--subtitle-timeout-ms", type=int, default=900_000)
    parser.add_argument("--min-srt-blocks", type=int, default=1, help="Minimum number of SRT blocks expected in the download.")
    return parser.parse_args(argv)


def require_playwright():
    try:
        from playwright.sync_api import expect, sync_playwright
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Playwright is not installed. Run:\n"
            "  pdm install -G test\n"
            "  pdm run browser-install\n"
        ) from exc
    return expect, sync_playwright


def url_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError):
        return False


def wait_for_url(url: str, label: str, timeout: float = 120.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if url_ok(url):
            return
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for {label} at {url}")


def maybe_start_servers(args: argparse.Namespace) -> list[ManagedProcess]:
    if args.no_start:
        wait_for_url(f"{args.service_url}/api/health", "local service")
        wait_for_url(args.frontend_url, "frontend")
        return []

    processes: list[ManagedProcess] = []
    if not url_ok(f"{args.service_url}/api/health"):
        service = ManagedProcess("service", ["pdm", "run", "service"], ROOT)
        service.start()
        processes.append(service)
    if not url_ok(args.frontend_url):
        web = ManagedProcess("web", ["pdm", "run", "web"], ROOT)
        web.start()
        processes.append(web)

    wait_for_url(f"{args.service_url}/api/health", "local service")
    wait_for_url(args.frontend_url, "frontend")
    return processes


def validate_srt(path: Path, min_blocks: int) -> None:
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise AssertionError(f"Downloaded SRT is empty: {path}")
    if "-->" not in text:
        raise AssertionError(f"Downloaded file does not look like SRT: missing timestamp arrow in {path}")
    blocks = [block for block in re.split(r"\n\s*\n", text.strip()) if block.strip()]
    if len(blocks) < min_blocks:
        raise AssertionError(f"Expected at least {min_blocks} SRT block(s), got {len(blocks)} in {path}")
    if not re.search(r"^1\s*$", text, re.MULTILINE):
        raise AssertionError(f"Downloaded SRT does not contain a first subtitle block: {path}")
    has_subtitle_text = False
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        cue_text_lines = [
            line for line in lines
            if not line.isdigit() and "-->" not in line
        ]
        if any(cue_text_lines):
            has_subtitle_text = True
            break
    if not has_subtitle_text:
        raise AssertionError(f"Downloaded SRT has no subtitle text: {path}")


def log_step(message: str) -> None:
    print(f"[browser-e2e] {message}", flush=True)


def run_browser_workflow(args: argparse.Namespace) -> Path:
    expect, sync_playwright = require_playwright()
    if not args.video.is_file():
        raise SystemExit(f"Video fixture not found: {args.video}")

    args.download_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        log_step("Launching Chromium")
        browser = p.chromium.launch(headless=not args.headed, slow_mo=args.slow_mo_ms)
        context = browser.new_context(accept_downloads=True, service_workers="block")
        page = context.new_page()
        page.set_default_timeout(30_000)

        try:
            log_step(f"Opening frontend {args.frontend_url}")
            page.goto(args.frontend_url, wait_until="domcontentloaded")

            log_step(f"Uploading video {args.video}")
            page.locator("#fileInput").set_input_files(str(args.video))
            expect(page.locator("#videoCard")).to_be_visible()
            expect(page.locator("#identifyButton")).to_be_enabled()

            log_step("Clicking Identify language")
            page.locator("#identifyButton").click()
            expect(page.locator("#sourceLanguageOutput")).to_contain_text(
                f"Source language: {args.expected_source_label}",
                timeout=args.language_timeout_ms,
            )

            log_step(f"Selecting target language {args.target}")
            target_select = page.locator("#targetLanguageSelect")
            expect(target_select).to_be_enabled()
            target_select.select_option(args.target)
            expect(page.locator("#segmentButton")).to_be_enabled()

            log_step("Clicking Audio segmentation")
            page.locator("#segmentButton").click()
            expect(page.locator("#generateButton")).to_be_enabled(timeout=args.segmentation_timeout_ms)
            expect(page.locator("#segmentationStatus")).to_contain_text("speech segments prepared")

            log_step("Clicking Generate subtitles")
            page.locator("#generateButton").click()
            download_link = page.locator("#downloadLink")
            expect(download_link).to_be_visible(timeout=args.subtitle_timeout_ms)
            expect(download_link).to_contain_text("Download")

            log_step("Capturing SRT download")
            with page.expect_download(timeout=60_000) as download_info:
                download_link.click()
            download = download_info.value
            suggested = download.suggested_filename or f"xololingua-{args.target}.srt"
            destination = args.download_dir / suggested
            if destination.exists():
                destination.unlink()
            download.save_as(destination)
        finally:
            context.close()
            browser.close()

    validate_srt(destination, args.min_srt_blocks)
    return destination


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    processes: list[ManagedProcess] = []
    try:
        processes = maybe_start_servers(args)
        downloaded = run_browser_workflow(args)
        print(f"Browser E2E succeeded for target={args.target}: {downloaded}")
        print(f"Downloaded SRT size: {downloaded.stat().st_size} bytes")
        return 0
    finally:
        if not args.keep_servers:
            for process in reversed(processes):
                process.stop()


if __name__ == "__main__":
    raise SystemExit(main())
