#!/usr/bin/env python3
"""Run the slow real API E2E workflow and verify a generated SRT artifact.

The workflow intentionally uses the local HTTP service instead of in-process
helpers: upload the real MP4 for language detection, extract audio, segment it,
create a subtitle job, poll it to completion, then write and verify an SRT file.
"""

from __future__ import annotations

import argparse
import json
import re
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
DEFAULT_SERVICE_URL = "http://127.0.0.1:8765"
DEFAULT_OUTPUT_DIR = ROOT / "tmp" / "e2e-validations"
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}


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


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, help="Target language code for generated subtitles.")
    parser.add_argument("--source", default="fr", help="Expected source language code for the fixture.")
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO, help="MP4 video used as the real E2E fixture.")
    parser.add_argument("--service-url", default=DEFAULT_SERVICE_URL, help="URL of the local backend service.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Directory where the verified .srt artifact is written.")
    parser.add_argument("--no-start", action="store_true", help="Do not auto-start PDM service; require it to be already reachable.")
    parser.add_argument("--keep-service", action="store_true", help="Leave an auto-started service running.")
    parser.add_argument("--poll-interval", type=float, default=2.0, help="Seconds between subtitle-job polls.")
    parser.add_argument("--job-timeout", type=float, default=1800.0, help="Seconds to wait for subtitle-job completion.")
    parser.add_argument("--min-srt-blocks", type=int, default=1, help="Minimum number of SRT blocks expected in the generated artifact.")
    return parser.parse_args(argv)


def log_step(message: str) -> None:
    print(f"[api-e2e] {message}", flush=True)


def url_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError):
        return False


def wait_for_service(service_url: str, timeout: float = 180.0) -> None:
    health_url = f"{service_url}/api/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        if url_ok(health_url):
            return
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for local service at {health_url}")


def maybe_start_service(args: argparse.Namespace) -> ManagedProcess | None:
    if args.no_start:
        wait_for_service(args.service_url)
        return None
    if url_ok(f"{args.service_url}/api/health"):
        return None
    service = ManagedProcess("service", ["pdm", "run", "service"], ROOT)
    service.start()
    wait_for_service(args.service_url)
    return service


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, method: str | None = None, timeout: float = 120.0) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} from {url}: {body}") from error


def post_json(service_url: str, path: str, payload: dict, timeout: float = 120.0) -> dict:
    return request_json(
        f"{service_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
        timeout=timeout,
    )


def post_video(service_url: str, path: str, video: Path, timeout: float = 600.0) -> dict:
    boundary = f"XOLOLINGUA_API_E2E_{int(time.time() * 1000)}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="video"; filename="{video.name}"\r\n'
        "Content-Type: video/mp4\r\n\r\n"
    ).encode("utf-8") + video.read_bytes() + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return request_json(
        f"{service_url}{path}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
        timeout=timeout,
    )


def assert_supported_pair(service_url: str, source: str, target: str) -> None:
    payload = request_json(f"{service_url}/api/translation-pairs")
    pairs = {(pair.get("source"), pair.get("target")) for pair in payload.get("pairs", [])}
    if (source, target) not in pairs:
        raise RuntimeError(f"Translation pair {source}->{target} is not exposed by /api/translation-pairs")


def poll_subtitle_job(service_url: str, job_id: str, *, interval: float, timeout: float) -> dict:
    deadline = time.time() + timeout
    last_status: dict = {}
    while time.time() < deadline:
        time.sleep(interval)
        last_status = request_json(f"{service_url}/api/subtitle-jobs/{job_id}", timeout=60.0)
        log_step(f"job {job_id}: {last_status.get('status')} / {last_status.get('stage')} - {last_status.get('message', '')}")
        if last_status.get("status") in TERMINAL_JOB_STATUSES:
            if last_status.get("status") == "succeeded":
                return last_status
            raise RuntimeError(f"Subtitle job {job_id} ended as {last_status.get('status')}: {last_status.get('error') or last_status.get('message')}")
    raise RuntimeError(f"Timed out waiting for subtitle job {job_id}; last status: {last_status}")


def format_srt_time(seconds: float) -> str:
    milliseconds = round(float(seconds) * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def format_srt(segments: list[dict]) -> str:
    blocks: list[str] = []
    for fallback_index, segment in enumerate(segments, start=1):
        text = str(segment.get("translatedText") or segment.get("text") or "").strip()
        blocks.append("\n".join([
            str(segment.get("index") or fallback_index),
            f"{format_srt_time(float(segment['start']))} --> {format_srt_time(float(segment['end']))}",
            text,
        ]))
    return "\n\n".join(blocks) + "\n"


def validate_srt(path: Path, min_blocks: int) -> None:
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise AssertionError(f"SRT artifact is empty: {path}")
    if "-->" not in text:
        raise AssertionError(f"SRT artifact is missing timestamp arrows: {path}")
    blocks = [block for block in re.split(r"\n\s*\n", text.strip()) if block.strip()]
    if len(blocks) < min_blocks:
        raise AssertionError(f"Expected at least {min_blocks} SRT block(s), got {len(blocks)} in {path}")
    if not re.search(r"^1\s*$", text, re.MULTILINE):
        raise AssertionError(f"SRT artifact does not contain first subtitle block: {path}")


def run_api_workflow(args: argparse.Namespace) -> Path:
    if not args.video.is_file():
        raise SystemExit(f"Video fixture not found: {args.video}")
    if args.source == args.target:
        raise SystemExit("Source and target languages must differ.")

    log_step("Checking exposed translation pair")
    assert_supported_pair(args.service_url, args.source, args.target)

    log_step("Detecting language through API")
    detected = post_video(args.service_url, "/api/detect-language", args.video)
    detected_code = detected.get("languageCode")
    if detected_code != args.source:
        raise RuntimeError(f"Expected source {args.source}, detected {detected_code}: {detected}")

    log_step("Extracting audio through API")
    extracted = post_video(args.service_url, "/api/extract-audio", args.video)
    audio_id = extracted["audioId"]

    try:
        log_step("Segmenting audio through API")
        segmented = post_json(args.service_url, "/api/segment-audio", {"audioId": audio_id}, timeout=300.0)
        segments = segmented.get("segments", [])
        if not segments:
            raise RuntimeError("API segmentation returned no segments")

        log_step(f"Creating subtitle job for {args.source}->{args.target}")
        job = post_json(args.service_url, "/api/subtitle-jobs", {
            "audioId": audio_id,
            "sourceLanguage": args.source,
            "targetLanguage": args.target,
            "segments": segments,
        })
        job_id = job["jobId"]
        completed = poll_subtitle_job(args.service_url, job_id, interval=args.poll_interval, timeout=args.job_timeout)
        translated_segments = completed.get("segments", [])
        if not translated_segments:
            raise RuntimeError(f"Subtitle job {job_id} succeeded without segments")

        args.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = args.output_dir / f"{args.video.stem}.{args.source}-{args.target}.srt"
        output_path.write_text(format_srt(translated_segments), encoding="utf-8")
        validate_srt(output_path, args.min_srt_blocks)
        return output_path
    finally:
        with suppress(Exception):
            post_json(args.service_url, "/api/release-audio", {"audioId": audio_id}, timeout=30.0)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    service: ManagedProcess | None = None
    try:
        service = maybe_start_service(args)
        artifact = run_api_workflow(args)
        print(f"API E2E succeeded for target={args.target}: {artifact}")
        print(f"Generated SRT size: {artifact.stat().st_size} bytes")
        return 0
    finally:
        if service is not None and not args.keep_service:
            service.stop()


if __name__ == "__main__":
    raise SystemExit(main())
