#!/usr/bin/env python3
"""Compare standard sequential and internal-batch Whisper WebGPU ASR."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Iterable

from asr_dtype_benchmark import (
    DEFAULT_FRONTEND_URL,
    DEFAULT_OUTPUT_DIR,
    extract_pcm,
    frontend_is_available,
    text_similarity,
    wait_for_frontend,
)
from web_serve import WEBGPU_FLAGS, find_webgpu_browser


ROOT = Path(__file__).resolve().parents[1]


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--start-seconds", type=float, default=0.0)
    parser.add_argument("--duration-seconds", type=float, default=120.0)
    parser.add_argument("--language", default="fr")
    parser.add_argument("--model", default="Xenova/whisper-base")
    parser.add_argument("--dtype", default="q4")
    parser.add_argument("--batch-size", type=int, choices=(1, 2, 4), default=2)
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--browser", help="Explicit Brave/Chromium executable.")
    parser.add_argument("--no-start", action="store_true")
    return parser.parse_args(argv)


def benchmark_batching(
    page,
    *,
    model: str,
    dtype: str,
    language: str,
    duration_seconds: float,
    batch_size: int,
) -> dict:
    return page.evaluate(
        """
        async ({ model, dtype, language, durationSeconds, batchSize }) => {
          const raw = await fetch('/__xololingua_asr_batching_benchmark.raw').then((response) => {
            if (!response.ok) throw new Error(`Benchmark PCM fetch failed: ${response.status}`);
            return response.arrayBuffer();
          });
          const pcm = new Float32Array(raw);
          const worker = new Worker('/frontend/transcription_worker.js', { type: 'module' });
          const progress = { sequential: [], batched: [] };
          let activeProgress = null;
          const waitFor = (expectedType, timeoutMs) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`ASR batching benchmark timed out waiting for ${expectedType}`)), timeoutMs);
            worker.onmessage = ({ data }) => {
              if (data?.type === 'progress') {
                if (activeProgress) progress[activeProgress].push(data.event || {});
                return;
              }
              if (data?.type === 'error') {
                clearTimeout(timer);
                reject(new Error(data.error || 'ASR worker failed'));
                return;
              }
              if (data?.type === expectedType) {
                clearTimeout(timer);
                resolve(data.metadata || data.result || {});
              }
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message || 'ASR worker crashed'));
            };
          });
          const transcribe = async (internalBatching, purgeAfterUse) => {
            const resultPromise = waitFor('result', 900000);
            worker.postMessage({
              type: 'transcribe',
              request: {
                modelId: model,
                dtype,
                device: 'webgpu',
                remoteModels: true,
                purgeAfterUse,
                sourceLanguage: language,
                internalBatching,
                internalBatchSize: internalBatching ? batchSize : 1,
                segments: [{ index: 1, start: 0, end: durationSeconds }],
                audio: { pcm, sampleRate: 16000, sampleRateHz: 16000, durationSeconds },
              },
            });
            const result = await resultPromise;
            return {
              text: (result.segments || []).map((segment) => segment.text || '').join(' ').trim(),
              segmentCount: (result.segments || []).length,
              metadata: result.metadata || {},
            };
          };
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
              throw new Error(warmup.deviceFallbackReason || 'Warmup did not use WebGPU');
            }
            activeProgress = 'sequential';
            const sequential = await transcribe(false, false);
            activeProgress = 'batched';
            let batched;
            try {
              batched = await transcribe(true, true);
            } catch (error) {
              batched = { error: error?.message || String(error), metadata: {} };
            }
            return { warmup, sequential, batched, progress };
          } finally {
            worker.terminate();
          }
        }
        """,
        {
            "model": model,
            "dtype": dtype,
            "language": language,
            "durationSeconds": duration_seconds,
            "batchSize": batch_size,
        },
    )


def evaluate_acceptance(result: dict) -> dict:
    sequential = result.get("sequential", {})
    batched = result.get("batched", {})
    sequential_timings = sequential.get("metadata", {}).get("timings", {})
    batched_timings = batched.get("metadata", {}).get("timings", {})
    sequential_ms = float(sequential_timings.get("inferenceMs") or 0)
    batched_ms = float(batched_timings.get("inferenceMs") or 0)
    similarity = text_similarity(sequential.get("text", ""), batched.get("text", ""))
    speedup = 1 - batched_ms / sequential_ms if sequential_ms > 0 and batched_ms > 0 else 0.0
    assignment_ratio = float(batched_timings.get("wordAssignmentRatio", 0))
    checks = {
        "webGpu": batched.get("metadata", {}).get("executionDevice") == "webgpu",
        "internalBatching": batched_timings.get("batchMode") == "internal-adaptive",
        "noSequentialFallback": batched_timings.get("mode") in {"webgpu-internal-batch", "webgpu-direct-windowed"},
        "textSimilarityAtLeast95Percent": similarity >= 0.95,
        "wordAssignmentAtLeast98Percent": assignment_ratio >= 0.98,
        "speedupAtLeast25Percent": speedup >= 0.25,
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "textSimilarity": round(similarity, 4),
        "wordAssignmentRatio": round(assignment_ratio, 4),
        "speedupRatio": round(speedup, 4),
        "sequentialInferenceMs": sequential_ms,
        "batchedInferenceMs": batched_ms,
    }


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.video.is_file():
        raise SystemExit(f"Video not found: {args.video}")
    if args.duration_seconds < 120:
        raise SystemExit("--duration-seconds must be at least 120 for the structural batching benchmark.")
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
    try:
        with tempfile.TemporaryDirectory(prefix="xolo-asr-batching-") as temp_dir:
            temp_root = Path(temp_dir)
            pcm_bytes = extract_pcm(
                args.video,
                temp_root / "sample.f32le",
                args.start_seconds,
                args.duration_seconds,
            )
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
                    "**/__xololingua_asr_batching_benchmark.raw",
                    lambda route: route.fulfill(status=200, content_type="application/octet-stream", body=pcm_bytes),
                )
                page.goto(args.frontend_url, wait_until="domcontentloaded")
                result = benchmark_batching(
                    page,
                    model=args.model,
                    dtype=args.dtype,
                    language=args.language,
                    duration_seconds=args.duration_seconds,
                    batch_size=args.batch_size,
                )
                context.close()
    finally:
        if web_process is not None and web_process.poll() is None:
            web_process.terminate()
            with suppress(subprocess.TimeoutExpired):
                web_process.wait(timeout=10)
            if web_process.poll() is None:
                web_process.kill()

    acceptance = evaluate_acceptance(result)
    report = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "video": str(args.video.resolve()),
        "sample": {"startSeconds": args.start_seconds, "durationSeconds": args.duration_seconds},
        "modelId": args.model,
        "dtype": args.dtype,
        "language": args.language,
        "requestedBatchSize": args.batch_size,
        "browser": browser,
        "result": result,
        "acceptance": acceptance,
    }
    output = args.output_dir / f"asr-batching-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[asr-batching] sequential={acceptance['sequentialInferenceMs']}ms", flush=True)
    print(f"[asr-batching] batched={acceptance['batchedInferenceMs']}ms speedup={acceptance['speedupRatio']:.1%}", flush=True)
    print(f"[asr-batching] similarity={acceptance['textSimilarity']:.1%} assignment={acceptance['wordAssignmentRatio']:.1%}", flush=True)
    if result.get("batched", {}).get("error"):
        print(f"[asr-batching] batch failure: {result['batched']['error']}", flush=True)
    print(f"[asr-batching] Report: {output}", flush=True)
    return 0 if acceptance["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
