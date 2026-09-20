#!/usr/bin/env python3
"""Benchmark Whisper WebGPU dtypes on one reproducible 30-second audio sample."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Iterable

from web_serve import WEBGPU_FLAGS, find_webgpu_browser


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FRONTEND_URL = "http://127.0.0.1:4173"
DEFAULT_OUTPUT_DIR = Path.home() / ".cache" / "xololingua" / "benchmarks"
DTYPES = ("fp16", "q4f16", "q4")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True, help="Video used to extract the benchmark sample.")
    parser.add_argument("--start-seconds", type=float, default=0.0)
    parser.add_argument("--duration-seconds", type=float, default=30.0)
    parser.add_argument("--language", default="fr")
    parser.add_argument("--model", default="Xenova/whisper-base")
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--browser", help="Explicit Brave/Chromium executable.")
    parser.add_argument("--no-start", action="store_true", help="Require the frontend server to be running already.")
    return parser.parse_args(argv)


def frontend_is_available(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2.0) as response:
            return 200 <= response.status < 400
    except (OSError, urllib.error.URLError):
        return False


def wait_for_frontend(url: str, timeout_seconds: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if frontend_is_available(url):
            return
        time.sleep(0.25)
    raise RuntimeError(f"Frontend did not become ready at {url}.")


def extract_pcm(video: Path, output: Path, start_seconds: float, duration_seconds: float) -> bytes:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(start_seconds), "-i", str(video), "-t", str(duration_seconds),
            "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", str(output),
        ],
        check=True,
    )
    return output.read_bytes()


def normalized_tokens(text: str) -> Counter[str]:
    return Counter(re.findall(r"[^\W\d_]+", text.casefold(), flags=re.UNICODE))


def text_similarity(left: str, right: str) -> float:
    left_tokens = normalized_tokens(left)
    right_tokens = normalized_tokens(right)
    if not left_tokens and not right_tokens:
        return 1.0
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = sum(min(left_tokens[token], right_tokens[token]) for token in left_tokens | right_tokens)
    precision = overlap / sum(left_tokens.values())
    recall = overlap / sum(right_tokens.values())
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def benchmark_dtype(page, *, dtype: str, model: str, language: str, duration_seconds: float) -> dict:
    return page.evaluate(
        """
        async ({ dtype, model, language, durationSeconds }) => {
          const raw = await fetch('/__xololingua_asr_benchmark.raw').then((response) => {
            if (!response.ok) throw new Error(`Benchmark PCM fetch failed: ${response.status}`);
            return response.arrayBuffer();
          });
          const pcm = new Float32Array(raw);
          const worker = new Worker('/frontend/transcription_worker.js', { type: 'module' });
          const progress = [];
          const waitFor = (expectedType, timeoutMs) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${dtype} benchmark timed out waiting for ${expectedType}`)), timeoutMs);
            worker.onmessage = ({ data }) => {
              if (data?.type === 'progress') {
                progress.push(data.event || {});
                return;
              }
              if (data?.type === 'error') {
                clearTimeout(timer);
                reject(new Error(data.error || `${dtype} worker failed`));
                return;
              }
              if (data?.type === expectedType) {
                clearTimeout(timer);
                resolve(data.metadata || data.result || {});
              }
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message || `${dtype} worker crashed`));
            };
          });
          try {
            const warmupPromise = waitFor('warmup-complete', 900000);
            worker.postMessage({
              type: 'warmup',
              request: {
                modelId: model,
                dtype,
                device: 'webgpu',
                remoteModels: true,
                purgeOnError: true,
                sampleSeconds: 1,
                sourceLanguage: language,
              },
            });
            const warmup = await warmupPromise;
            if (warmup.executionDevice !== 'webgpu') {
              throw new Error(warmup.deviceFallbackReason || `Expected WebGPU, received ${warmup.executionDevice || 'unknown'}`);
            }

            const inferencePromise = waitFor('result', 900000);
            worker.postMessage({
              type: 'transcribe',
              request: {
                modelId: model,
                dtype,
                device: 'webgpu',
                remoteModels: true,
                purgeAfterUse: true,
                sourceLanguage: language,
                audio: { pcm, sampleRate: 16000, sampleRateHz: 16000, durationSeconds },
              },
            });
            const result = await inferencePromise;
            if (result.metadata?.executionDevice !== 'webgpu') {
              throw new Error(result.metadata?.deviceFallbackReason || 'Inference did not use WebGPU');
            }
            return {
              dtype,
              status: 'ok',
              text: (result.segments || []).map((segment) => segment.text || '').join(' ').trim(),
              segmentCount: (result.segments || []).length,
              warmup: warmup.timings || {},
              timings: result.metadata?.timings || {},
              adapterInfo: result.metadata?.webGpuAdapterInfo || warmup.webGpuAdapterInfo || {},
              cachePurged: result.metadata?.cachePurged === true,
              filesDeleted: result.metadata?.filesDeleted || 0,
              progress,
            };
          } finally {
            worker.terminate();
          }
        }
        """,
        {"dtype": dtype, "model": model, "language": language, "durationSeconds": duration_seconds},
    )


def rank_results(results: list[dict]) -> list[dict]:
    successful = [result for result in results if result.get("status") == "ok"]
    if not successful:
        return []
    reference = next((result for result in successful if result["dtype"] == "fp16"), successful[0])
    for result in successful:
        result["similarityToReference"] = round(text_similarity(result.get("text", ""), reference.get("text", "")), 4)
    eligible = [result for result in successful if result["similarityToReference"] >= 0.95]
    eligible.sort(key=lambda result: float(result.get("timings", {}).get("inferenceMs", float("inf"))))
    return [
        {
            "rank": index,
            "dtype": result["dtype"],
            "inferenceMs": result.get("timings", {}).get("inferenceMs"),
            "realtimeFactor": result.get("timings", {}).get("realtimeFactor"),
            "similarityToReference": result["similarityToReference"],
        }
        for index, result in enumerate(eligible, start=1)
    ]


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.video.is_file():
        raise SystemExit(f"Video not found: {args.video}")
    if args.duration_seconds <= 0:
        raise SystemExit("--duration-seconds must be positive.")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit("Playwright is required. Run: pdm install -G test") from exc

    browser = args.browser or find_webgpu_browser()
    if not browser:
        raise SystemExit("No Brave/Chromium browser was found.")

    web_process: subprocess.Popen[str] | None = None
    if not frontend_is_available(args.frontend_url):
        if args.no_start:
            raise SystemExit(f"Frontend is not reachable at {args.frontend_url}")
        web_process = subprocess.Popen(
            ["pdm", "run", "web", "--no-browser"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        wait_for_frontend(args.frontend_url)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    try:
        with tempfile.TemporaryDirectory(prefix="xolo-asr-benchmark-") as temp_dir:
            temp_root = Path(temp_dir)
            raw_path = temp_root / "sample.f32le"
            pcm_bytes = extract_pcm(args.video, raw_path, args.start_seconds, args.duration_seconds)
            with sync_playwright() as playwright:
                context = playwright.chromium.launch_persistent_context(
                    user_data_dir=str(temp_root / "browser-profile"),
                    executable_path=browser,
                    headless=False,
                    service_workers="block",
                    args=[*WEBGPU_FLAGS, "--ignore-gpu-blocklist"],
                )
                page = context.pages[0] if context.pages else context.new_page()
                page.route(
                    "**/__xololingua_asr_benchmark.raw",
                    lambda route: route.fulfill(status=200, content_type="application/octet-stream", body=pcm_bytes),
                )
                page.goto(args.frontend_url, wait_until="domcontentloaded")
                for dtype in DTYPES:
                    print(f"[asr-benchmark] Running {dtype}...", flush=True)
                    try:
                        result = benchmark_dtype(
                            page,
                            dtype=dtype,
                            model=args.model,
                            language=args.language,
                            duration_seconds=args.duration_seconds,
                        )
                        print(
                            f"[asr-benchmark] {dtype}: inference={result.get('timings', {}).get('inferenceMs')}ms "
                            f"realtime={result.get('timings', {}).get('realtimeFactor')}",
                            flush=True,
                        )
                    except Exception as exc:
                        result = {"dtype": dtype, "status": "failed", "error": str(exc)}
                        print(f"[asr-benchmark] {dtype}: failed — {exc}", flush=True)
                    results.append(result)
                context.close()
    finally:
        if web_process is not None and web_process.poll() is None:
            web_process.terminate()
            with suppress(subprocess.TimeoutExpired):
                web_process.wait(timeout=10)
            if web_process.poll() is None:
                web_process.kill()

    ranking = rank_results(results)
    report = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "video": str(args.video.resolve()),
        "sample": {"startSeconds": args.start_seconds, "durationSeconds": args.duration_seconds},
        "modelId": args.model,
        "language": args.language,
        "browser": browser,
        "results": results,
        "ranking": ranking,
        "recommendedDtype": ranking[0]["dtype"] if ranking else None,
    }
    output = args.output_dir / f"asr-dtype-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[asr-benchmark] Report: {output}", flush=True)
    if ranking:
        print(f"[asr-benchmark] Recommended dtype: {ranking[0]['dtype']}", flush=True)
        return 0
    print("[asr-benchmark] No WebGPU dtype completed successfully.", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
