#!/usr/bin/env python3
"""Run the real browser E2E workflow and verify the downloaded SRT.

This script validates XoloLingua as a user would:
open the app, upload an MP4, identify the source language, choose a target,
segment audio, generate subtitles, capture the browser download, and inspect
its SRT content.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from contextlib import suppress
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path("/root/android-app-games/resources/lisoir_dnde442_quarter.mp4")
DEFAULT_FRONTEND_URL = "http://127.0.0.1:4173"
DEFAULT_SERVICE_URL = "http://127.0.0.1:8765"
DEFAULT_TMP_ROOT = Path(
    os.environ.get(
        "XOLOLINGUA_TMP_DIR",
        Path.home() / ".cache" / "xololingua" / "tmp",
    )
)
DEFAULT_DOWNLOAD_DIR = Path(
    os.environ.get(
        "XOLOLINGUA_BROWSER_E2E_DOWNLOAD_DIR",
        DEFAULT_TMP_ROOT / "browser-e2e-downloads",
    )
)
DYNAMIC_TRANSCRIPTION_MODEL_ID = "Xenova/whisper-base"


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
    parser.add_argument("--min-srt-blocks", type=int, default=0, help="Minimum number of SRT blocks expected in the download; 0 uses a duration-scaled guard.")
    parser.add_argument("--min-srt-bytes", type=int, default=0, help="Minimum downloaded SRT size; 0 uses a duration-scaled guard.")
    parser.add_argument("--min-segments", type=int, default=0, help="Minimum number of VAD segments sent to transcription; 0 uses a duration-scaled guard.")
    parser.add_argument("--min-coverage-ratio", type=float, default=0.85, help="Minimum last-segment/SRT timestamp divided by video duration.")
    parser.add_argument(
        "--stop-after-segmentation",
        action="store_true",
        help="Stop after segmentation runtime assertions instead of generating subtitles.",
    )
    parser.add_argument(
        "--require-browser-audio",
        action="store_true",
        help="Fail unless the final pipeline status proves audio extraction ran in the browser.",
    )
    parser.add_argument(
        "--require-browser-vad",
        action="store_true",
        help="Fail unless the final pipeline status proves VAD segmentation ran in the browser.",
    )
    parser.add_argument(
        "--require-browser-transcription",
        action="store_true",
        help="Fail unless the final pipeline status proves transcription ran in the browser.",
    )
    parser.add_argument(
        "--require-browser-translation",
        action="store_true",
        help="Fail unless the final pipeline status proves translation ran in the browser.",
    )
    parser.add_argument(
        "--inject-backend-reference-browser-ml",
        action="store_true",
        help=(
            "Inject deterministic browser transcription/translation adapters seeded from "
            "a real backend reference run. This validates full-browser routing without "
            "requiring heavyweight browser ML model downloads in CI."
        ),
    )
    parser.add_argument(
        "--real-browser-models",
        action="store_true",
        help=(
            "Run browser ASR/translation with real on-demand Hugging Face models. Deterministic "
            "backend-reference adapters are forbidden; downloads and post-pipeline cache purge "
            "are asserted."
        ),
    )
    parser.add_argument(
        "--compare-backend-srt",
        action="store_true",
        help="Run the full backend subtitle pipeline and compare its SRT with the browser output.",
    )
    parser.add_argument("--source", default="fr", help="Expected source language code for backend reference comparison.")
    parser.add_argument("--compare-min-text-similarity", type=float, default=0.90)
    parser.add_argument("--compare-max-block-delta", type=int, default=2)
    parser.add_argument("--compare-max-last-end-delta", type=float, default=5.0)
    args = parser.parse_args(argv)
    if args.real_browser_models and args.inject_backend_reference_browser_ml:
        parser.error("--real-browser-models cannot be combined with --inject-backend-reference-browser-ml")
    return args


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


def probe_video_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def parse_srt_timestamp(value: str) -> float:
    match = re.fullmatch(r"(?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}),(?P<ms>\d{3})", value.strip())
    if not match:
        raise AssertionError(f"Invalid SRT timestamp: {value!r}")
    return (
        int(match.group("h")) * 3600
        + int(match.group("m")) * 60
        + int(match.group("s"))
        + int(match.group("ms")) / 1000
    )


def cue_duration_summary(durations: list[float]) -> dict:
    if not durations:
        return {
            "cueDurationsSeconds": [],
            "medianCueDurationSeconds": 0.0,
            "p90CueDurationSeconds": 0.0,
        }
    ordered = sorted(durations)
    count = len(ordered)
    midpoint = count // 2
    if count % 2:
        median = ordered[midpoint]
    else:
        median = (ordered[midpoint - 1] + ordered[midpoint]) / 2
    p90_index = max(0, min(count - 1, ((9 * count + 9) // 10) - 1))
    return {
        "cueDurationsSeconds": durations,
        "medianCueDurationSeconds": median,
        "p90CueDurationSeconds": ordered[p90_index],
    }


def collect_srt_diagnostics(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise AssertionError(f"Downloaded SRT is empty: {path}")
    if "-->" not in text:
        raise AssertionError(f"Downloaded file does not look like SRT: missing timestamp arrow in {path}")
    blocks = [block for block in re.split(r"\n\s*\n", text.strip()) if block.strip()]
    if not re.search(r"^1\s*$", text, re.MULTILINE):
        raise AssertionError(f"Downloaded SRT does not contain a first subtitle block: {path}")
    has_subtitle_text = False
    last_end = 0.0
    cue_durations = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timestamp_lines = [line for line in lines if "-->" in line]
        if timestamp_lines:
            start_timestamp, end_timestamp = [
                value.strip()
                for value in timestamp_lines[-1].split("-->", 1)
            ]
            start_seconds = parse_srt_timestamp(start_timestamp)
            end_seconds = parse_srt_timestamp(end_timestamp)
            last_end = max(last_end, end_seconds)
            if end_seconds > start_seconds:
                cue_durations.append(round(end_seconds - start_seconds, 3))
        cue_text_lines = [
            line for line in lines
            if not line.isdigit() and "-->" not in line
        ]
        if any(cue_text_lines):
            has_subtitle_text = True
    if not has_subtitle_text:
        raise AssertionError(f"Downloaded SRT has no subtitle text: {path}")
    return {
        "bytes": path.stat().st_size,
        "blocks": len(blocks),
        "lastEndSeconds": last_end,
        "text": text,
        **cue_duration_summary(cue_durations),
    }


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
    boundary = f"XOLOLINGUA_BROWSER_E2E_{int(time.time() * 1000)}"
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


def poll_subtitle_job(service_url: str, job_id: str, *, interval: float = 2.0, timeout: float = 1800.0) -> dict:
    deadline = time.time() + timeout
    last_status: dict = {}
    while time.time() < deadline:
        time.sleep(interval)
        last_status = request_json(f"{service_url}/api/subtitle-jobs/{job_id}", timeout=60.0)
        log_step(f"backend reference job {job_id}: {last_status.get('status')} / {last_status.get('stage')} - {last_status.get('message', '')}")
        if last_status.get("status") in {"succeeded", "failed", "cancelled"}:
            if last_status.get("status") == "succeeded":
                return last_status
            raise RuntimeError(f"Backend reference job {job_id} ended as {last_status.get('status')}: {last_status.get('error') or last_status.get('message')}")
    raise RuntimeError(f"Timed out waiting for backend reference job {job_id}; last status: {last_status}")


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


def validate_srt(path: Path, args: argparse.Namespace, duration_seconds: float, segment_diagnostics: dict) -> None:
    diagnostics = collect_srt_diagnostics(path)
    segment_count = int(segment_diagnostics.get("count", 0))
    last_segment_end = float(segment_diagnostics.get("lastEndSeconds", 0.0))
    srt_coverage_ratio = diagnostics["lastEndSeconds"] / duration_seconds if duration_seconds > 0 else 0.0
    segment_coverage_ratio = last_segment_end / duration_seconds if duration_seconds > 0 else 0.0
    min_srt_blocks = args.min_srt_blocks or max(1, int(duration_seconds // 16))
    min_segments = args.min_segments or max(1, int(duration_seconds // 16))
    min_srt_bytes = args.min_srt_bytes or max(1_000, int(duration_seconds * 12))

    failures = []
    if diagnostics["blocks"] < min_srt_blocks:
        failures.append(f"SRT blocks {diagnostics['blocks']} < expected {min_srt_blocks}")
    if diagnostics["bytes"] < min_srt_bytes:
        failures.append(f"SRT size {diagnostics['bytes']} bytes < expected {min_srt_bytes} bytes")
    if segment_count < min_segments:
        failures.append(f"VAD segments {segment_count} < expected {min_segments}")
    if segment_coverage_ratio < args.min_coverage_ratio:
        failures.append(
            f"VAD temporal coverage {segment_coverage_ratio:.3f} "
            f"({last_segment_end:.3f}s / {duration_seconds:.3f}s) < expected {args.min_coverage_ratio:.3f}"
        )
    if srt_coverage_ratio < args.min_coverage_ratio:
        failures.append(
            f"SRT temporal coverage {srt_coverage_ratio:.3f} "
            f"({diagnostics['lastEndSeconds']:.3f}s / {duration_seconds:.3f}s) < expected {args.min_coverage_ratio:.3f}"
        )

    print(
        "Browser E2E diagnostics: "
        f"duration={duration_seconds:.3f}s; "
        f"segments={segment_count}; "
        f"lastSegmentEnd={last_segment_end:.3f}s; "
        f"segmentCoverage={segment_coverage_ratio:.3f}; "
        f"srtBlocks={diagnostics['blocks']}; "
        f"srtBytes={diagnostics['bytes']}; "
        f"lastSrtEnd={diagnostics['lastEndSeconds']:.3f}s; "
        f"srtCoverage={srt_coverage_ratio:.3f}; "
        f"minSegments={min_segments}; "
        f"minSrtBlocks={min_srt_blocks}; "
        f"minSrtBytes={min_srt_bytes}",
        flush=True,
    )
    if failures:
        raise AssertionError("Browser E2E output coverage checks failed:\n- " + "\n- ".join(failures))


def run_backend_reference(args: argparse.Namespace) -> dict:
    log_step("Running full backend reference pipeline for browser comparison")
    detected = post_video(args.service_url, "/api/detect-language", args.video)
    if detected.get("languageCode") != args.source:
        raise RuntimeError(f"Expected source {args.source}, detected {detected.get('languageCode')}: {detected}")
    extracted = post_video(args.service_url, "/api/extract-audio", args.video)
    audio_id = extracted["audioId"]
    try:
        segmented = post_json(args.service_url, "/api/segment-audio", {"audioId": audio_id}, timeout=300.0)
        segments = segmented.get("segments", [])
        if not segments:
            raise RuntimeError("Backend reference segmentation returned no segments")
        job = post_json(args.service_url, "/api/subtitle-jobs", {
            "audioId": audio_id,
            "sourceLanguage": args.source,
            "targetLanguage": args.target,
            "segments": segments,
        })
        completed = poll_subtitle_job(args.service_url, job["jobId"], timeout=args.subtitle_timeout_ms / 1000)
        translated_segments = completed.get("segments", [])
        if not translated_segments:
            raise RuntimeError("Backend reference subtitle job succeeded without segments")
        return {
            "audio": extracted,
            "segments": segments,
            "translatedSegments": translated_segments,
            "srtText": format_srt(translated_segments),
        }
    finally:
        with suppress(Exception):
            # Keep backend-reference cleanup bounded so a slow release endpoint cannot
            # consume the browser real-model subtitle timeout window.
            post_json(args.service_url, "/api/release-audio", {"audioId": audio_id}, timeout=3.0)


def write_backend_reference_artifact(args: argparse.Namespace, backend_reference: dict) -> Path:
    args.download_dir.mkdir(parents=True, exist_ok=True)
    path = args.download_dir / f"{args.video.stem}.{args.source}-{args.target}.backend-reference.srt"
    path.write_text(backend_reference["srtText"], encoding="utf-8")
    return path


def normalize_srt_text_for_similarity(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip().lower()
        if not stripped or stripped.isdigit() or "-->" in stripped:
            continue
        lines.append(re.sub(r"\s+", " ", stripped))
    return " ".join(lines)


def tokenize_srt_text_for_similarity(text: str) -> Counter[str]:
    stopwords = {
        "the", "and", "that", "for", "you", "with", "this", "are", "was", "were",
        "but", "not", "all", "can", "its", "into", "from", "have", "has", "had",
        "his", "her", "our", "your",
    }
    tokens = [
        token
        for token in re.findall(r"[a-z]{3,}", normalize_srt_text_for_similarity(text))
        if token not in stopwords
    ]
    return Counter(tokens)


def srt_text_similarity(browser_text: str, backend_text: str) -> float:
    browser_tokens = tokenize_srt_text_for_similarity(browser_text)
    backend_tokens = tokenize_srt_text_for_similarity(backend_text)
    if not browser_tokens and not backend_tokens:
        return 1.0
    if not browser_tokens or not backend_tokens:
        return 0.0
    keys = set(browser_tokens) | set(backend_tokens)
    overlap = sum(min(browser_tokens[key], backend_tokens[key]) for key in keys)
    browser_total = sum(browser_tokens.values())
    backend_total = sum(backend_tokens.values())
    precision = overlap / browser_total if browser_total else 0.0
    recall = overlap / backend_total if backend_total else 0.0
    return (2 * precision * recall / (precision + recall)) if precision + recall else 0.0


def describe_segmentation_quality(browser: dict, backend: dict) -> dict:
    browser_blocks = int(browser.get("blocks", 0))
    backend_blocks = int(backend.get("blocks", 0))
    browser_median = float(browser.get("medianCueDurationSeconds", 0.0))
    backend_median = float(backend.get("medianCueDurationSeconds", 0.0))
    block_ratio = browser_blocks / backend_blocks if backend_blocks else 0.0
    median_cue_ratio = browser_median / backend_median if backend_median else 0.0
    warnings = []
    if block_ratio >= 2.5:
        warnings.append(f"browser block count is {block_ratio:.2f}x backend")
    if 0 < median_cue_ratio <= 0.5:
        warnings.append(f"browser median cue duration is {median_cue_ratio:.2f}x backend")
    return {
        "blockRatio": block_ratio,
        "medianCueRatio": median_cue_ratio,
        "warnings": warnings,
    }


def compare_srt_outputs(browser_path: Path, backend_path: Path, args: argparse.Namespace) -> None:
    browser = collect_srt_diagnostics(browser_path)
    backend = collect_srt_diagnostics(backend_path)
    block_delta = abs(browser["blocks"] - backend["blocks"])
    last_end_delta = abs(browser["lastEndSeconds"] - backend["lastEndSeconds"])
    similarity = srt_text_similarity(browser["text"], backend["text"])
    segmentation_quality = describe_segmentation_quality(browser, backend)
    segmentation_warning = "; ".join(segmentation_quality["warnings"]) or "none"
    print(
        "Browser/backend SRT comparison: "
        f"browserBlocks={browser['blocks']}; "
        f"backendBlocks={backend['blocks']}; "
        f"blockDelta={block_delta}; "
        f"blockRatio={segmentation_quality['blockRatio']:.3f}; "
        f"browserMedianCue={browser['medianCueDurationSeconds']:.3f}s; "
        f"backendMedianCue={backend['medianCueDurationSeconds']:.3f}s; "
        f"medianCueRatio={segmentation_quality['medianCueRatio']:.3f}; "
        f"browserP90Cue={browser['p90CueDurationSeconds']:.3f}s; "
        f"backendP90Cue={backend['p90CueDurationSeconds']:.3f}s; "
        f"browserLastEnd={browser['lastEndSeconds']:.3f}s; "
        f"backendLastEnd={backend['lastEndSeconds']:.3f}s; "
        f"lastEndDelta={last_end_delta:.3f}s; "
        f"textSimilarity={similarity:.3f}; "
        f"segmentationWarning={segmentation_warning}",
        flush=True,
    )
    failures = []
    if block_delta > args.compare_max_block_delta and not args.real_browser_models:
        failures.append(f"SRT block delta {block_delta} > expected {args.compare_max_block_delta}")
    if last_end_delta > args.compare_max_last_end_delta:
        failures.append(f"SRT last timestamp delta {last_end_delta:.3f}s > expected {args.compare_max_last_end_delta:.3f}s")
    if similarity < args.compare_min_text_similarity:
        failures.append(f"SRT text similarity {similarity:.3f} < expected {args.compare_min_text_similarity:.3f}")
    if failures:
        raise AssertionError("Browser/backend SRT comparison failed:\n- " + "\n- ".join(failures))


def assert_browser_audio_runtime(pipeline_status: str) -> None:
    if not re.search(r"Audio extraction:\s*Browser\b", pipeline_status):
        raise AssertionError(
            "Expected browser audio extraction in final pipeline status, "
            f"got: {pipeline_status!r}"
        )


def assert_browser_vad_runtime(pipeline_status: str) -> None:
    if not re.search(r"VAD\s*/\s*segmentation:\s*Browser\b", pipeline_status):
        raise AssertionError(
            "Expected browser VAD segmentation in final pipeline status, "
            f"got: {pipeline_status!r}"
        )


def assert_browser_transcription_runtime(pipeline_status: str) -> None:
    if not re.search(r"Transcription:\s*Browser\b", pipeline_status):
        raise AssertionError(
            "Expected browser transcription in final pipeline status, "
            f"got: {pipeline_status!r}"
        )


def assert_browser_translation_runtime(pipeline_status: str) -> None:
    if not re.search(r"Translation:\s*Browser\b", pipeline_status):
        raise AssertionError(
            "Expected browser translation in final pipeline status, "
            f"got: {pipeline_status!r}"
        )


def create_backend_reference_init_script(backend_reference: dict) -> str:
    reference_json = json.dumps(backend_reference)
    return f"""
(() => {{
  const reference = {reference_json};
  const byPosition = (segments, index) => Array.isArray(segments) ? segments[index] || {{}} : {{}};
  window.transformersJs = true;
  window.XOLOLINGUA_CLIENT_TRANSCRIBER = {{
    async transcribeAudio(request, onProgress = () => {{}}) {{
      const inputSegments = Array.isArray(request?.segments) ? request.segments : [];
      onProgress({{ stage: 'transcribing', progress: 10, message: 'Browser reference transcription started.' }});
      const segments = inputSegments.map((segment, index) => {{
        const referenceSegment = byPosition(reference.translatedSegments, index);
        return {{
          index: segment.index || index + 1,
          start: segment.start,
          end: segment.end,
          text: referenceSegment.translatedText || referenceSegment.text || ''
        }};
      }});
      onProgress({{ stage: 'transcribing', progress: 100, message: 'Browser reference transcription completed.' }});
      return {{ language: request?.sourceLanguage || 'unknown', segments }};
    }}
  }};
  window.XOLOLINGUA_CLIENT_TRANSLATOR = {{
    async translateSegments(request, onProgress = () => {{}}) {{
      const inputSegments = Array.isArray(request?.segments) ? request.segments : [];
      onProgress({{ stage: 'translating', progress: 10, message: 'Browser reference translation started.' }});
      const segments = inputSegments.map((segment, index) => {{
        const referenceSegment = byPosition(reference.translatedSegments, index);
        return {{
          index: segment.index || index + 1,
          start: segment.start,
          end: segment.end,
          text: referenceSegment.translatedText || referenceSegment.text || segment.text || ''
        }};
      }});
      onProgress({{ stage: 'translating', progress: 100, message: 'Browser reference translation completed.' }});
      return {{ segments }};
    }}
  }};
}})();
"""


def dynamic_model_ids(source: str, target: str) -> list[str]:
    return [
        DYNAMIC_TRANSCRIPTION_MODEL_ID,
        f"Xenova/opus-mt-{source.lower()}-{target.lower()}",
    ]


def match_dynamic_model_id(url: str, model_ids: Iterable[str]) -> str | None:
    decoded_url = urllib.parse.unquote(url)
    if "huggingface.co/" not in decoded_url:
        return None
    for model_id in model_ids:
        if f"huggingface.co/{model_id}/" in decoded_url:
            return model_id
    return None


def validate_dynamic_model_network(
    model_ids: Iterable[str],
    downloaded_model_ids: Iterable[str],
    failed_requests: Iterable[dict],
    local_model_urls: Iterable[str],
) -> None:
    expected = set(model_ids)
    downloaded = set(downloaded_model_ids)
    missing = sorted(expected - downloaded)
    if missing:
        raise AssertionError(
            "Expected on-demand Hugging Face downloads for: " + ", ".join(missing)
        )
    failures = list(failed_requests)
    if failures:
        formatted = ", ".join(
            f"{failure.get('status', 'network')} {failure.get('url', '')}"
            for failure in failures[:5]
        )
        raise AssertionError(f"Dynamic model downloads failed: {formatted}")
    local_urls = list(local_model_urls)
    if local_urls:
        raise AssertionError(
            "Legacy local model URLs were requested: " + ", ".join(local_urls[:5])
        )


def inspect_dynamic_model_cache_in_page(page, model_ids: list[str]) -> dict:
    return page.evaluate(
        """
        async (modelIds) => {
          if (!('caches' in window)) {
            return {
              cacheAvailable: false,
              cacheNames: [],
              matchingEntries: [],
              cachePurged: false,
            };
          }
          const cacheNames = await caches.keys();
          const matchingEntries = [];
          for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            for (const request of requests) {
              const decodedUrl = decodeURIComponent(request.url);
              const modelId = modelIds.find((candidate) => decodedUrl.includes(candidate));
              if (modelId) {
                matchingEntries.push({ cacheName, modelId, url: request.url });
              }
            }
          }
          return {
            cacheAvailable: true,
            cacheNames,
            matchingEntries,
            cachePurged: matchingEntries.length === 0,
          };
        }
        """,
        model_ids,
    )


def format_real_model_diagnostics(report: dict) -> str:
    warmup = report.get("warmup") or {}
    inference = report.get("inference") or {}
    model_ids = report.get("modelIds") or []
    parts = [
        f"status={report.get('status', 'unknown')}",
        f"runtime={report.get('runtime', 'chromium')}",
        f"models={','.join(model_ids) if model_ids else 'none'}",
        f"downloads={report.get('downloadedRequests', 0)}",
        f"downloadFailures={report.get('failedRequests', 0)}",
        f"cachePurged={str(bool(report.get('cachePurged'))).lower()}",
        f"remainingCacheEntries={report.get('remainingCacheEntries', 0)}",
        f"warmup=asr:{warmup.get('asr', 'unknown')},translation:{warmup.get('translation', 'unknown')}",
        f"inference=asr:{inference.get('asr', 'unknown')},translation:{inference.get('translation', 'unknown')}",
        f"coverage={report.get('coverage', 'unknown')}",
        f"comparison={report.get('comparison', 'unknown')}",
        f"reason={report.get('reason', '')}",
        f"action={report.get('action', '')}",
    ]
    return "Browser real-model diagnostics: " + "; ".join(str(part).replace("\\n", " ") for part in parts)


def emit_real_model_diagnostics(report: dict) -> None:
    print(format_real_model_diagnostics(report), flush=True)


def log_step(message: str) -> None:
    print(f"[browser-e2e] {message}", flush=True)


def run_browser_workflow(args: argparse.Namespace) -> Path | None:
    expect, sync_playwright = require_playwright()
    if not args.video.is_file():
        raise SystemExit(f"Video fixture not found: {args.video}")

    duration_seconds = probe_video_duration(args.video)
    transcribe_segments: list[dict] = []
    args.download_dir.mkdir(parents=True, exist_ok=True)
    backend_reference = run_backend_reference(args) if (args.inject_backend_reference_browser_ml or args.compare_backend_srt) else None
    backend_reference_path = write_backend_reference_artifact(args, backend_reference) if backend_reference else None
    model_ids = dynamic_model_ids(args.source, args.target) if args.real_browser_models else []
    downloaded_model_ids: set[str] = set()
    model_request_urls: list[str] = []
    failed_model_requests: list[dict] = []
    local_model_urls: list[str] = []
    real_model_report: dict | None = None
    frontend_origin = urllib.parse.urlparse(args.frontend_url)

    with sync_playwright() as p:
        log_step("Launching Chromium")
        browser = None
        if args.real_browser_models:
            user_data_dir = args.download_dir / "chromium-real-model-profile"
            if user_data_dir.exists():
                shutil.rmtree(user_data_dir)
            user_data_dir.mkdir(parents=True, exist_ok=True)
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(user_data_dir),
                headless=not args.headed,
                slow_mo=args.slow_mo_ms,
                accept_downloads=True,
                service_workers="block",
            )
        else:
            browser = p.chromium.launch(headless=not args.headed, slow_mo=args.slow_mo_ms)
            context = browser.new_context(accept_downloads=True, service_workers="block")
        if args.inject_backend_reference_browser_ml:
            if not backend_reference:
                raise AssertionError("Backend reference is required to inject browser ML adapters.")
            context.add_init_script(create_backend_reference_init_script(backend_reference))
        page = context.new_page()
        page.set_default_timeout(30_000)

        def capture_model_request(request) -> None:
            if not args.real_browser_models:
                return
            parsed = urllib.parse.urlparse(request.url)
            if parsed.netloc == frontend_origin.netloc and parsed.path.startswith("/models/"):
                local_model_urls.append(request.url)
            model_id = match_dynamic_model_id(request.url, model_ids)
            if model_id:
                downloaded_model_ids.add(model_id)
                model_request_urls.append(request.url)

        def capture_model_response(response) -> None:
            model_id = match_dynamic_model_id(response.url, model_ids)
            if model_id and response.status >= 400:
                failed_model_requests.append({
                    "modelId": model_id,
                    "status": response.status,
                    "url": response.url,
                })

        def capture_model_request_failure(request) -> None:
            model_id = match_dynamic_model_id(request.url, model_ids)
            if model_id:
                failed_model_requests.append({
                    "modelId": model_id,
                    "status": "network-error",
                    "url": request.url,
                })

        def capture_transcribe_request(request) -> None:
            if not request.url.endswith("/api/transcribe-audio"):
                return
            try:
                payload = json.loads(request.post_data or "{}")
            except json.JSONDecodeError:
                return
            segments = payload.get("segments", [])
            if isinstance(segments, list):
                transcribe_segments.clear()
                transcribe_segments.extend(segment for segment in segments if isinstance(segment, dict))

        page.on("request", capture_transcribe_request)
        context.on("request", capture_model_request)
        context.on("response", capture_model_response)
        context.on("requestfailed", capture_model_request_failure)

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
            segmentation_pipeline_status = page.locator("#segmentationStatus").inner_text()
            segment_count_text = page.locator("#segmentCountSummary").inner_text()
            segment_speech_text = page.locator("#segmentSpeechSummary").inner_text()
            segment_average_text = page.locator("#segmentAverageSummary").inner_text()
            print(
                "Browser segmentation diagnostics: "
                f"segments={segment_count_text}; "
                f"speechTime={segment_speech_text}; "
                f"averageDuration={segment_average_text}; "
                f"status={segmentation_pipeline_status}",
                flush=True,
            )
            if args.require_browser_audio:
                assert_browser_audio_runtime(segmentation_pipeline_status)
            if args.require_browser_vad:
                assert_browser_vad_runtime(segmentation_pipeline_status)

            if args.stop_after_segmentation:
                destination = None
                return destination

            log_step("Clicking Generate subtitles")
            page.locator("#generateButton").click()
            download_link = page.locator("#downloadLink")
            expect(download_link).to_be_visible(timeout=args.subtitle_timeout_ms)
            expect(download_link).to_contain_text("Download")
            final_pipeline_status = page.locator("#subtitleStatus").inner_text()
            if args.require_browser_audio:
                assert_browser_audio_runtime(final_pipeline_status)
            if args.require_browser_vad:
                assert_browser_vad_runtime(final_pipeline_status)
            if args.require_browser_transcription:
                assert_browser_transcription_runtime(final_pipeline_status)
            if args.require_browser_translation:
                assert_browser_translation_runtime(final_pipeline_status)

            if args.real_browser_models:
                validate_dynamic_model_network(
                    model_ids,
                    downloaded_model_ids,
                    failed_model_requests,
                    local_model_urls,
                )
                cache_report = inspect_dynamic_model_cache_in_page(page, model_ids)
                if not cache_report.get("cacheAvailable"):
                    raise AssertionError("Cache API is unavailable; dynamic model purge cannot be verified.")
                if not cache_report.get("cachePurged"):
                    remaining = cache_report.get("matchingEntries") or []
                    raise AssertionError(
                        "Dynamic model cache was not purged after subtitle generation: "
                        + ", ".join(entry.get("url", "") for entry in remaining[:5])
                    )
                real_model_report = {
                    "status": "pass",
                    "runtime": "chromium",
                    "modelIds": model_ids,
                    "downloadedRequests": len(model_request_urls),
                    "failedRequests": len(failed_model_requests),
                    "cachePurged": True,
                    "remainingCacheEntries": 0,
                    "warmup": {"asr": "pass", "translation": "pass"},
                    "inference": {"asr": "pass", "translation": "pass"},
                    "coverage": "pass",
                    "comparison": "pass" if args.compare_backend_srt else "not-requested",
                    "reason": "on-demand browser model lifecycle completed",
                    "action": "none",
                }

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
            if browser is not None:
                browser.close()

    if destination is None:
        return destination

    if transcribe_segments:
        segment_diagnostics = {
            "count": len(transcribe_segments),
            "lastEndSeconds": max((float(segment.get("end", 0.0)) for segment in transcribe_segments), default=0.0),
        }
    else:
        srt_diagnostics = collect_srt_diagnostics(destination)
        segment_diagnostics = {
            "count": srt_diagnostics["blocks"],
            "lastEndSeconds": srt_diagnostics["lastEndSeconds"],
        }
    validate_srt(destination, args, duration_seconds, segment_diagnostics)
    if args.compare_backend_srt:
        if backend_reference_path is None:
            raise AssertionError("Backend reference artifact is required for SRT comparison.")
        compare_srt_outputs(destination, backend_reference_path, args)
    if real_model_report:
        emit_real_model_diagnostics(real_model_report)
    return destination


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    processes: list[ManagedProcess] = []
    try:
        processes = maybe_start_servers(args)
        downloaded = run_browser_workflow(args)
        if downloaded is None:
            print(f"Browser E2E segmentation guards succeeded for target={args.target}")
        else:
            print(f"Browser E2E succeeded for target={args.target}: {downloaded}")
            print(f"Downloaded SRT size: {downloaded.stat().st_size} bytes")
        return 0
    finally:
        if not args.keep_servers:
            for process in reversed(processes):
                process.stop()


if __name__ == "__main__":
    raise SystemExit(main())
