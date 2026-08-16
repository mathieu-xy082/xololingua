#!/usr/bin/env python3
"""Compare browser Whisper ASR modes on one continuous video excerpt.

The benchmark deliberately skips the Python service, language detection, and
translation. It runs browser VAD once, warms Whisper once, then transcribes the
same PCM with both long-form and VAD-segment modes in one WebGPU worker.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import suppress
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path.home() / "Téléchargements" / "savefromnet" / "xololingua_test" / "lisoir_dnde442.mp4"
DEFAULT_FRONTEND_URL = "http://127.0.0.1:4173"
DEFAULT_MODEL_ID = "Xenova/whisper-base"
MINIMUM_DURATION_SECONDS = 120.0
ASR_MODES = ("long-form", "vad-segments")


class ManagedProcess:
    def __init__(self, command: list[str], cwd: Path):
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
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO)
    parser.add_argument("--start-seconds", type=float, default=0.0)
    parser.add_argument("--duration-seconds", type=float, default=MINIMUM_DURATION_SECONDS)
    parser.add_argument("--source", default="fr", help="Whisper source language code.")
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--no-start", action="store_true", help="Require the frontend server to already be reachable.")
    parser.add_argument("--headless", action="store_true", help="Use headless Chrome (hardware WebGPU may be unavailable).")
    parser.add_argument("--device", choices=("webgpu", "wasm", "auto"), default="webgpu")
    parser.add_argument(
        "--order",
        choices=("long-form-first", "vad-segments-first"),
        default="vad-segments-first",
        help="Execution order; both modes reuse the same warmed model.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=1800.0, help="Timeout for each ASR mode.")
    parser.add_argument("--output", type=Path, help="Optional path for the JSON report.")
    args = parser.parse_args(argv)
    if args.start_seconds < 0:
        parser.error("--start-seconds must be non-negative")
    if args.duration_seconds < MINIMUM_DURATION_SECONDS:
        parser.error(f"--duration-seconds must be at least {MINIMUM_DURATION_SECONDS:g}")
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    return args


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Playwright is not installed. Run:\n"
            "  pdm install -G test\n"
            "  pdm run browser-install\n"
        ) from exc
    return sync_playwright


def url_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError):
        return False


def wait_for_url(url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if url_ok(url):
            return
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for frontend at {url}")


def maybe_start_frontend(args: argparse.Namespace) -> ManagedProcess | None:
    if url_ok(args.frontend_url):
        return None
    if args.no_start:
        wait_for_url(args.frontend_url, timeout=2.0)
    process = ManagedProcess([sys.executable, "scripts/web_serve.py", "--no-browser"], ROOT)
    process.start()
    try:
        wait_for_url(args.frontend_url)
    except Exception:
        process.stop()
        raise
    return process


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


def build_ffmpeg_command(video: Path, output: Path, start_seconds: float, duration_seconds: float) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-t",
        f"{duration_seconds:.3f}",
        "-i",
        str(video),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output),
    ]


def extract_audio(video: Path, output: Path, start_seconds: float, duration_seconds: float) -> None:
    subprocess.run(
        build_ffmpeg_command(video, output, start_seconds, duration_seconds),
        check=True,
    )


def normalize_transcript(result: dict) -> str:
    text = " ".join(str(segment.get("text", "")) for segment in result.get("segments", []))
    return " ".join(re.findall(r"\w+", text.lower(), flags=re.UNICODE))


def summarize_report(report: dict) -> dict:
    results = report.get("results", {})
    fixture_duration = float(report.get("segmentation", {}).get("durationSeconds") or 0)
    summaries = {}
    for mode in ASR_MODES:
        result = results.get(mode, {})
        timings = result.get("metadata", {}).get("timings", {})
        transcript = normalize_transcript(result)
        end_times = [
            float(segment.get("end") or 0)
            for segment in result.get("segments", [])
            if isinstance(segment, dict)
        ]
        summaries[mode] = {
            "wallMs": result.get("benchmarkWallMs"),
            "inferenceMs": timings.get("inferenceMs"),
            "realtimeFactor": timings.get("realtimeFactor"),
            "audioSeconds": timings.get("audioSeconds"),
            "outputSegments": len(result.get("segments", [])),
            "wordCount": len(transcript.split()),
            "lastEndSeconds": max(end_times, default=0),
            "segmentsPastAudioEnd": sum(end > fixture_duration + 0.1 for end in end_times),
        }
    long_ms = summaries["long-form"].get("inferenceMs")
    vad_ms = summaries["vad-segments"].get("inferenceMs")
    speedup = (vad_ms / long_ms) if isinstance(long_ms, (int, float)) and long_ms > 0 and isinstance(vad_ms, (int, float)) else None
    similarity = SequenceMatcher(
        None,
        normalize_transcript(results.get("long-form", {})),
        normalize_transcript(results.get("vad-segments", {})),
    ).ratio()
    return {
        "modes": summaries,
        "longFormSpeedupVsVad": round(speedup, 3) if speedup is not None else None,
        "transcriptSimilarity": round(similarity, 3),
    }


BROWSER_BENCHMARK = r"""
async ({ audioUrl, sourceLanguage, modelId, device, modes, timeoutMs }) => {
  const report = {
    ok: false,
    adapter: null,
    segmentation: null,
    warmup: null,
    results: {},
    progress: [],
    cleanup: { attempted: false, workerTerminated: false },
  };
  let worker = null;
  let workerReachedTerminalState = true;

  const send = (type, request, expectedType, requestTimeoutMs) => new Promise((resolve, reject) => {
    let lastProgressMessage = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${type} timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
    };
    const onWorkerError = (event) => {
      cleanup();
      reject(new Error(event.message || `Worker failed during ${type}`));
    };
    const onMessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        const label = String(message.event?.message || "");
        if (label && label !== lastProgressMessage) {
          lastProgressMessage = label;
          report.progress.push({ request: type, ...message.event });
          console.log(`[ASR benchmark] ${type}: ${label}`);
        }
        return;
      }
      if (message.type === "error") {
        workerReachedTerminalState = true;
        cleanup();
        reject(new Error(message.error || `${type} failed`));
        return;
      }
      if (message.type === expectedType) {
        workerReachedTerminalState = true;
        cleanup();
        resolve(message.result ?? message.metadata ?? message);
      }
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    worker.postMessage({ type, request });
  });

  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    report.adapter = adapter ? {
      available: true,
      vendor: adapter.info?.vendor || "",
      architecture: adapter.info?.architecture || "",
      device: adapter.info?.device || "",
      description: adapter.info?.description || "",
    } : { available: false };
    if (device === "webgpu" && !adapter) throw new Error("Chrome did not expose a WebGPU adapter");
    const adapterIdentity = `${report.adapter.vendor} ${report.adapter.architecture}`.trim().toLowerCase();
    if (device === "webgpu" && (adapterIdentity.includes("swiftshader") || adapterIdentity.startsWith("google"))) {
      throw new Error(`Chrome exposed a software WebGPU adapter: ${adapterIdentity}`);
    }

    const response = await fetch(audioUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Audio fixture request failed: HTTP ${response.status}`);
    const audioBlob = await response.blob();
    const { createVadWebRuntimeSegmenter } = await import("/frontend/vad_web_runtime.js");
    const segmenter = createVadWebRuntimeSegmenter({
      environment: window,
      vadProfile: "backend-compatible",
      workerUrl: "/frontend/vad_worker.js",
    });
    const segmentationStartedAt = performance.now();
    const segmentation = await segmenter({ audioBlob }, (progress) => {
      console.log(`[ASR benchmark] VAD ${Math.round(Number(progress) || 0)}%`);
    });
    const decoded = await window.vad.utils.audioFileToArray(audioBlob);
    if (!(decoded.audio instanceof Float32Array)) throw new Error("VAD decoder did not return Float32 PCM");
    const durationSeconds = decoded.audio.length / decoded.sampleRate;
    report.segmentation = {
      segmentCount: segmentation.segments.length,
      speechSeconds: Math.round(segmentation.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0) * 1000) / 1000,
      durationSeconds,
      wallMs: Math.round((performance.now() - segmentationStartedAt) * 10) / 10,
      metadata: segmentation.metadata,
      segments: segmentation.segments,
    };

    worker = new Worker("/frontend/transcription_worker.js", { type: "module" });
    workerReachedTerminalState = false;
    report.warmup = await send("warmup", {
      modelId,
      sampleSeconds: 1,
      sourceLanguage,
      remoteModels: true,
      device,
    }, "warmup-complete", timeoutMs);
    workerReachedTerminalState = true;

    for (const mode of modes) {
      workerReachedTerminalState = false;
      const startedAt = performance.now();
      const result = await send("transcribe", {
        audio: {
          pcm: decoded.audio,
          sampleRate: decoded.sampleRate,
          durationSeconds,
        },
        segments: segmentation.segments,
        sourceLanguage,
        modelId,
        remoteModels: true,
        device,
        transcriptionMode: mode,
        purgeAfterUse: false,
        purgeOnError: false,
      }, "result", timeoutMs);
      workerReachedTerminalState = true;
      result.benchmarkWallMs = Math.round((performance.now() - startedAt) * 10) / 10;
      report.results[mode] = result;
    }
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (worker) {
      report.cleanup.attempted = true;
      if (workerReachedTerminalState) {
        try {
          report.cleanup.release = await send(
            "dispose",
            { modelId, purgeCache: true },
            "dispose-complete",
            Math.min(timeoutMs, 120000),
          );
        } catch (error) {
          report.cleanup.releaseError = error instanceof Error ? error.message : String(error);
        }
      } else {
        report.cleanup.releaseSkipped = "ASR request did not reach a terminal worker message";
      }
      worker.terminate();
      report.cleanup.workerTerminated = true;
    }
    if (globalThis.caches) {
      report.cleanup.remainingCacheNames = await caches.keys();
    }
  }
  return report;
}
"""


def run_browser_benchmark(args: argparse.Namespace, wav_path: Path, profile_dir: Path) -> dict:
    sync_playwright = require_playwright()
    modes = list(ASR_MODES)
    if args.order == "vad-segments-first":
        modes.reverse()
    chromium_args = [
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--enable-features=Vulkan",
    ] if args.device == "webgpu" else []
    downloaded_urls: list[str] = []
    failed_urls: list[str] = []
    context = None
    page = None
    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                channel="chrome" if args.device == "webgpu" else None,
                headless=args.headless,
                service_workers="block",
                args=chromium_args,
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(30_000)
            page.on("console", lambda message: print(message.text, flush=True))
            context.on(
                "request",
                lambda request: downloaded_urls.append(request.url)
                if args.model_id.lower() in request.url.lower()
                else None,
            )
            context.on(
                "requestfailed",
                lambda request: failed_urls.append(request.url)
                if args.model_id.lower() in request.url.lower()
                else None,
            )
            page.route(
                "**/__asr_benchmark_audio.wav",
                lambda route: route.fulfill(path=str(wav_path), content_type="audio/wav"),
            )
            page.goto(args.frontend_url, wait_until="domcontentloaded")
            page.wait_for_function("window.vad?.utils?.audioFileToArray && window.ort?.env?.wasm")
            report = page.evaluate(
                BROWSER_BENCHMARK,
                {
                    "audioUrl": f"{args.frontend_url.rstrip('/')}/__asr_benchmark_audio.wav",
                    "sourceLanguage": args.source,
                    "modelId": args.model_id,
                    "device": args.device,
                    "modes": modes,
                    "timeoutMs": int(args.timeout_seconds * 1000),
                },
            )
            report["network"] = {
                "modelRequestCount": len(downloaded_urls),
                "failedModelRequests": failed_urls,
            }
            return report
        finally:
            if page is not None:
                with suppress(Exception):
                    page.close()
            if context is not None:
                with suppress(Exception):
                    context.close()


def validate_fixture(args: argparse.Namespace) -> float:
    if not args.video.is_file():
        raise SystemExit(f"Video fixture not found: {args.video}")
    duration = probe_video_duration(args.video)
    if args.start_seconds + args.duration_seconds > duration + 0.1:
        raise SystemExit(
            f"Requested excerpt ends at {args.start_seconds + args.duration_seconds:.3f}s "
            f"but video duration is {duration:.3f}s"
        )
    return duration


def print_report(report: dict) -> None:
    summary = report.get("summary", {})
    segmentation = report.get("segmentation", {})
    adapter = report.get("adapter", {})
    print(
        "Browser ASR benchmark: "
        f"adapter={adapter.get('vendor', 'unknown')} {adapter.get('architecture', '')}; "
        f"audio={segmentation.get('durationSeconds', 0):.1f}s; "
        f"VAD={segmentation.get('segmentCount', 0)} segments / {segmentation.get('speechSeconds', 0):.1f}s speech",
        flush=True,
    )
    for mode in ASR_MODES:
        metrics = summary.get("modes", {}).get(mode, {})
        print(
            f"  {mode}: inference={float(metrics.get('inferenceMs') or 0) / 1000:.1f}s; "
            f"wall={float(metrics.get('wallMs') or 0) / 1000:.1f}s; "
            f"RTF={float(metrics.get('realtimeFactor') or 0):.3f}; "
            f"words={metrics.get('wordCount', 0)}; segments={metrics.get('outputSegments', 0)}; "
            f"past-end={metrics.get('segmentsPastAudioEnd', 0)}",
            flush=True,
        )
    print(
        f"  long-form speedup vs VAD={summary.get('longFormSpeedupVsVad')}; "
        f"transcript similarity={summary.get('transcriptSimilarity')}; "
        f"cache purged={report.get('cleanup', {}).get('release', {}).get('cachePurged')}; "
        f"worker terminated={report.get('cleanup', {}).get('workerTerminated')}",
        flush=True,
    )


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    source_duration = validate_fixture(args)
    frontend = None
    try:
        frontend = maybe_start_frontend(args)
        with tempfile.TemporaryDirectory(prefix="xololingua-asr-benchmark-") as temporary_directory:
            temporary_root = Path(temporary_directory)
            wav_path = temporary_root / "excerpt.wav"
            profile_dir = temporary_root / "chrome-profile"
            print(
                f"Extracting {args.duration_seconds:.1f}s from {args.video} "
                f"(source duration {source_duration:.1f}s)...",
                flush=True,
            )
            extract_audio(args.video, wav_path, args.start_seconds, args.duration_seconds)
            report = run_browser_benchmark(args, wav_path, profile_dir)
        report["fixture"] = {
            "video": str(args.video),
            "sourceDurationSeconds": source_duration,
            "startSeconds": args.start_seconds,
            "durationSeconds": args.duration_seconds,
        }
        report["configuration"] = {
            "modelId": args.model_id,
            "sourceLanguage": args.source,
            "device": args.device,
            "order": args.order,
        }
        report["summary"] = summarize_report(report)
        print_report(report)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"JSON report: {args.output}", flush=True)
        if not report.get("ok"):
            raise RuntimeError(f"Browser ASR benchmark failed: {report.get('error', 'unknown error')}")
        cleanup = report.get("cleanup", {})
        if not cleanup.get("workerTerminated"):
            raise AssertionError("ASR worker was not terminated")
        if not cleanup.get("release", {}).get("cachePurged"):
            raise AssertionError(f"ASR model cache was not purged: {cleanup}")
        if args.device == "webgpu":
            for mode in ASR_MODES:
                execution_device = report["results"][mode].get("metadata", {}).get("executionDevice")
                if execution_device != "webgpu":
                    raise AssertionError(f"{mode} used {execution_device!r} instead of WebGPU")
        return 0
    finally:
        if frontend is not None:
            frontend.stop()


if __name__ == "__main__":
    raise SystemExit(main())
