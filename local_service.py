#!/usr/bin/env python3
"""Local development service for video audio preparation.

The browser cannot efficiently extract long MP4 audio without decoding large
buffers or shipping heavy WebAssembly. This service keeps that work on the
Ubuntu host and uses ffmpeg to create a segmentation-ready WAV file.
"""

from __future__ import annotations

import cgi
import json
import signal
import re
import shutil
import subprocess
import tempfile
import uuid
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse


HOST = "127.0.0.1"
PORT = 8765
MAX_DURATION_SECONDS = int(2.5 * 60 * 60)
MAX_SEGMENT_SECONDS = 12.0
MIN_SEGMENT_SECONDS = 0.4
SILENCE_NOISE = "-35dB"
SILENCE_DURATION_SECONDS = 0.45
WORK_DIR = Path(tempfile.gettempdir()) / "xololingua"
ARGOS_COMMAND = os.environ.get("XOLOLINGUA_ARGOS_COMMAND", "argos-translate")
SUBTITLE_JOB_WORKERS = int(os.environ.get("XOLOLINGUA_SUBTITLE_JOB_WORKERS", "1"))
TRANSLATION_WORKERS = int(os.environ.get("XOLOLINGUA_TRANSLATION_WORKERS", "2"))
WHISPER_DEVICE_CHOICE = os.environ.get("XOLOLINGUA_WHISPER_DEVICE", "auto")
WHISPER_GPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_GPU_MODEL", "base")
WHISPER_CPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_CPU_MODEL", "base")
WHISPER_GPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_GPU_COMPUTE_TYPE", "float16")
WHISPER_CPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_CPU_COMPUTE_TYPE", "int8")

# Path to the transcribe worker script (same directory as this file)
_SERVICE_DIR = Path(__file__).parent
TRANSCRIBE_WORKER = _SERVICE_DIR / "transcribe_worker.py"

# Python executable used by transcribe_worker.py. When started with PDM this is
# the project environment; XOLOLINGUA_WHISPER_PYTHON remains as an escape hatch.
_WHISPER_VENV_PYTHON = os.environ.get(
    "XOLOLINGUA_WHISPER_PYTHON",
    sys.executable,
)

# Runtime descriptor populated at startup by _detect_whisper_runtime()
WHISPER_RUNTIME: dict = {
    "backend": "unknown",
    "device": "cpu",
    "model": "base",
    "computeType": "int8",
    "cudaDevices": 0,
    "nvidiaSmi": False,
    "nvidiaSmiError": "",
    "fallbackReason": "",
    "requestedDevice": WHISPER_DEVICE_CHOICE,
    "available": False,
}

CPU_WHISPER_RUNTIME: dict = {
    "backend": "faster-whisper",
    "device": "cpu",
    "model": WHISPER_CPU_MODEL,
    "computeType": WHISPER_CPU_COMPUTE_TYPE,
    "cudaDevices": 0,
    "nvidiaSmi": False,
    "nvidiaSmiError": "",
    "fallbackReason": "Runtime fallback requested.",
    "requestedDevice": WHISPER_DEVICE_CHOICE,
    "available": True,
}

JOBS: dict[str, dict] = {}
JOB_FUTURES: dict[str, object] = {}
JOB_PROCESSES: dict[str, set[subprocess.Popen]] = {}
JOBS_LOCK = Lock()
JOBS_EXECUTOR = ThreadPoolExecutor(max_workers=SUBTITLE_JOB_WORKERS)
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}


class JobCancelled(Exception):
    """Raised when a subtitle job is cancelled while work is running."""


def _detect_whisper_runtime() -> None:
    """Probe the transcribe worker for GPU availability and populate WHISPER_RUNTIME."""
    global WHISPER_RUNTIME, CPU_WHISPER_RUNTIME
    worker_python = _WHISPER_VENV_PYTHON
    if not Path(worker_python).exists():
        print(f"[whisper] venv python not found at {worker_python}, falling back to system whisper CLI")
        WHISPER_RUNTIME = {"backend": "whisper-cli", "device": "cpu", "model": "base",
                           "computeType": "n/a", "cudaDevices": 0, "available": bool(shutil.which("whisper"))}
        return
    if not TRANSCRIBE_WORKER.exists():
        print(f"[whisper] transcribe_worker.py not found at {TRANSCRIBE_WORKER}")
        WHISPER_RUNTIME["available"] = False
        return
    try:
        result = subprocess.run(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--probe",
                "--device", WHISPER_DEVICE_CHOICE,
                "--gpu-model", WHISPER_GPU_MODEL,
                "--cpu-model", WHISPER_CPU_MODEL,
                "--gpu-compute-type", WHISPER_GPU_COMPUTE_TYPE,
                "--cpu-compute-type", WHISPER_CPU_COMPUTE_TYPE,
            ],
            check=True, capture_output=True, text=True, timeout=120,
        )
        runtime = json.loads(result.stdout.strip())
        WHISPER_RUNTIME = runtime
        CPU_WHISPER_RUNTIME = runtime if runtime.get("device") == "cpu" else _probe_cpu_whisper_runtime(worker_python)
        device_label = f"CUDA ({runtime.get('cudaDevices', 0)} GPU)" if runtime["device"] == "cuda" else "CPU"
        print(f"[whisper] faster-whisper ready — model={runtime['model']} device={device_label} compute={runtime['computeType']}")
        if runtime.get("fallbackReason"):
            print(f"[whisper] fallback reason: {runtime['fallbackReason']}")
        if runtime.get("device") == "cuda" and not CPU_WHISPER_RUNTIME.get("available"):
            print(f"[whisper] CPU fallback unavailable: {CPU_WHISPER_RUNTIME.get('fallbackReason', 'unknown')}")
    except Exception as exc:
        print(f"[whisper] probe failed ({exc}), falling back to whisper CLI")
        WHISPER_RUNTIME = {"backend": "whisper-cli", "device": "cpu", "model": "base",
                           "computeType": "n/a", "cudaDevices": 0, "available": bool(shutil.which("whisper")),
                           "nvidiaSmi": False, "nvidiaSmiError": "", "fallbackReason": str(exc),
                           "requestedDevice": WHISPER_DEVICE_CHOICE}
        CPU_WHISPER_RUNTIME = WHISPER_RUNTIME


def _probe_cpu_whisper_runtime(worker_python: str) -> dict:
    try:
        result = subprocess.run(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--probe",
                "--device", "cpu",
                "--cpu-model", WHISPER_CPU_MODEL,
                "--cpu-compute-type", WHISPER_CPU_COMPUTE_TYPE,
            ],
            check=True, capture_output=True, text=True, timeout=120,
        )
        return json.loads(result.stdout.strip())
    except Exception as exc:
        return {
            **CPU_WHISPER_RUNTIME,
            "available": False,
            "fallbackReason": str(exc),
        }


class LocalServiceHandler(BaseHTTPRequestHandler):
    server_version = "XoloLinguaLocalService/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed_path = urlparse(self.path)
        if self.path == "/api/health":
            self.send_json({
                "ok": True,
                "ffmpeg": bool(shutil.which("ffmpeg")),
                "ffprobe": bool(shutil.which("ffprobe")),
                "whisper": WHISPER_RUNTIME.get("available", False),
                "whisperBackend": WHISPER_RUNTIME.get("backend", "unknown"),
                "whisperModel": WHISPER_RUNTIME.get("model", "?"),
                "whisperDevice": WHISPER_RUNTIME.get("device", "?"),
                "whisperComputeType": WHISPER_RUNTIME.get("computeType", "?"),
                "whisperCudaDevices": WHISPER_RUNTIME.get("cudaDevices", 0),
                "whisperRequestedDevice": WHISPER_RUNTIME.get("requestedDevice", WHISPER_DEVICE_CHOICE),
                "whisperFallbackReason": WHISPER_RUNTIME.get("fallbackReason", ""),
                "whisperCpuFallbackAvailable": CPU_WHISPER_RUNTIME.get("available", False),
                "whisperCpuFallbackModel": CPU_WHISPER_RUNTIME.get("model", WHISPER_CPU_MODEL),
                "whisperCpuFallbackComputeType": CPU_WHISPER_RUNTIME.get("computeType", WHISPER_CPU_COMPUTE_TYPE),
                "whisperCpuFallbackReason": CPU_WHISPER_RUNTIME.get("fallbackReason", ""),
                "nvidiaSmi": WHISPER_RUNTIME.get("nvidiaSmi", False),
                "nvidiaSmiError": WHISPER_RUNTIME.get("nvidiaSmiError", ""),
                "argosTranslate": bool(shutil.which(ARGOS_COMMAND)),
                "argosCommand": ARGOS_COMMAND,
            })
            return
        if parsed_path.path.startswith("/api/subtitle-jobs/"):
            self.handle_get_subtitle_job(parsed_path.path.rsplit("/", 1)[-1])
            return

        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown endpoint.")

    def do_POST(self) -> None:
        parsed_path = urlparse(self.path)
        if self.path == "/api/extract-audio":
            self.handle_extract_audio()
            return
        if self.path == "/api/segment-audio":
            self.handle_segment_audio()
            return
        if self.path == "/api/transcribe-audio":
            self.handle_transcribe_audio()
            return
        if self.path == "/api/translate-segments":
            self.handle_translate_segments()
            return
        if self.path == "/api/subtitle-jobs":
            self.handle_create_subtitle_job()
            return
        if parsed_path.path.startswith("/api/subtitle-jobs/") and parsed_path.path.endswith("/cancel"):
            job_id = parsed_path.path.split("/")[-2]
            self.handle_cancel_subtitle_job(job_id)
            return

        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown endpoint.")

    def handle_extract_audio(self) -> None:
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "ffmpeg and ffprobe are required.")
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Expected multipart/form-data.")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        item = form["video"] if "video" in form else None
        if item is None or not getattr(item, "filename", ""):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Missing video file.")
            return

        original_name = Path(item.filename).name
        if not original_name.lower().endswith(".mp4"):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Only MP4 files are supported.")
            return

        WORK_DIR.mkdir(parents=True, exist_ok=True)
        request_id = uuid.uuid4().hex
        upload_path = WORK_DIR / f"{request_id}.mp4"
        audio_path = WORK_DIR / f"{request_id}.wav"

        try:
            with upload_path.open("wb") as destination:
                shutil.copyfileobj(item.file, destination, length=1024 * 1024)

            duration = probe_duration(upload_path)
            if duration <= 0:
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Could not read video duration.")
                return
            if duration > MAX_DURATION_SECONDS:
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Video exceeds the 2 h 30 min limit.")
                return

            extract_audio(upload_path, audio_path)
            self.send_json({
                "audioId": request_id,
                "originalFileName": original_name,
                "audioFileName": audio_path.name,
                "audioPath": str(audio_path),
                "audioSizeBytes": audio_path.stat().st_size,
                "durationSeconds": duration,
                "format": {
                    "container": "wav",
                    "codec": "pcm_s16le",
                    "sampleRateHz": 16000,
                    "channels": 1,
                },
            })
        except subprocess.CalledProcessError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error.stderr.strip() or "Audio extraction failed.")
        finally:
            upload_path.unlink(missing_ok=True)

    def handle_segment_audio(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Missing JSON body.")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body.")
            return

        audio_id = str(payload.get("audioId", ""))
        if not re.fullmatch(r"[a-f0-9]{32}", audio_id):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid audio id.")
            return

        audio_path = WORK_DIR / f"{audio_id}.wav"
        if not audio_path.exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Extracted audio file was not found.")
            return

        try:
            duration = probe_duration(audio_path)
            segments = segment_audio(audio_path, duration)
            self.send_json({
                "audioId": audio_id,
                "durationSeconds": duration,
                "segments": segments,
            })
        except subprocess.CalledProcessError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error.stderr.strip() or "Audio segmentation failed.")

    def handle_transcribe_audio(self) -> None:
        if not WHISPER_RUNTIME.get("available"):
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "Transcription engine not available. Install dependencies with PDM and start the service with `pdm run service`.",
            )
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Missing JSON body.")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body.")
            return

        audio_id = str(payload.get("audioId", ""))
        if not re.fullmatch(r"[a-f0-9]{32}", audio_id):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid audio id.")
            return

        audio_path = WORK_DIR / f"{audio_id}.wav"
        if not audio_path.exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Extracted audio file was not found.")
            return

        language_code = str(payload.get("languageCode", ""))
        segments_payload = payload.get("segments", [])
        try:
            segments = normalize_segments(segments_payload)
            transcribed_segments = transcribe_segments(audio_path, segments, language_code)
            self.send_json({
                "audioId": audio_id,
                "languageCode": language_code,
                "segments": transcribed_segments,
            })
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except subprocess.CalledProcessError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error.stderr.strip() or "Audio transcription failed.")

    def handle_translate_segments(self) -> None:
        if not shutil.which(ARGOS_COMMAND):
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                f"Translation engine not found. Install Argos Translate or set XOLOLINGUA_ARGOS_COMMAND. Tried: {ARGOS_COMMAND}.",
            )
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Missing JSON body.")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body.")
            return

        source_language = str(payload.get("sourceLanguage", ""))
        target_language = str(payload.get("targetLanguage", ""))
        segments_payload = payload.get("segments", [])

        try:
            segments = normalize_text_segments(segments_payload)
            translated_segments = translate_segments(segments, source_language, target_language)
            self.send_json({
                "sourceLanguage": source_language,
                "targetLanguage": target_language,
                "segments": translated_segments,
            })
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except subprocess.CalledProcessError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error.stderr.strip() or "Segment translation failed.")

    def handle_create_subtitle_job(self) -> None:
        if not WHISPER_RUNTIME.get("available"):
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "Transcription engine not available. Install dependencies with PDM and start the service with `pdm run service`.",
            )
            return
        if not shutil.which(ARGOS_COMMAND):
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                f"Translation engine not found. Install Argos Translate or set XOLOLINGUA_ARGOS_COMMAND. Tried: {ARGOS_COMMAND}.",
            )
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Missing JSON body.")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body.")
            return

        audio_id = str(payload.get("audioId", ""))
        if not re.fullmatch(r"[a-f0-9]{32}", audio_id):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid audio id.")
            return

        audio_path = WORK_DIR / f"{audio_id}.wav"
        if not audio_path.exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Extracted audio file was not found.")
            return

        source_language = str(payload.get("sourceLanguage", ""))
        target_language = str(payload.get("targetLanguage", ""))
        try:
            segments = normalize_segments(payload.get("segments", []))
            if not source_language or not target_language:
                raise ValueError("Source and target languages are required.")
            if source_language == target_language:
                raise ValueError("Source and target languages must differ.")
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
            return

        job_id = uuid.uuid4().hex
        put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "Queued subtitle generation.",
            "createdAt": time.time(),
            "updatedAt": time.time(),
            "segments": [],
            "error": "",
        })
        future = JOBS_EXECUTOR.submit(run_subtitle_job, job_id, audio_path, segments, source_language, target_language)
        register_job_future(job_id, future)
        self.send_json(job_snapshot(job_id), HTTPStatus.ACCEPTED)

    def handle_get_subtitle_job(self, job_id: str) -> None:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid job id.")
            return

        snapshot = job_snapshot(job_id)
        if snapshot is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Subtitle job was not found.")
            return

        self.send_json(snapshot)

    def handle_cancel_subtitle_job(self, job_id: str) -> None:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid job id.")
            return

        snapshot = cancel_subtitle_job(job_id)
        if snapshot is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Subtitle job was not found.")
            return

        self.send_json(snapshot)

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"ok": False, "error": message}, status)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def probe_duration(video_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def extract_audio(video_path: Path, audio_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def segment_audio(audio_path: Path, duration: float) -> list[dict]:
    silences = detect_silences(audio_path)
    raw_segments = speech_segments_from_silences(silences, duration)
    bounded_segments = split_long_segments(raw_segments, MAX_SEGMENT_SECONDS)

    return [
        {
            "index": index,
            "start": round(start, 3),
            "end": round(end, 3),
            "text": f"Speech segment {index}",
        }
        for index, (start, end) in enumerate(bounded_segments, start=1)
    ]


def detect_silences(audio_path: Path) -> list[tuple[float, float]]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(audio_path),
            "-af",
            f"silencedetect=noise={SILENCE_NOISE}:d={SILENCE_DURATION_SECONDS}",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    silences: list[tuple[float, float]] = []
    current_start: float | None = None
    for line in result.stderr.splitlines():
        start_match = re.search(r"silence_start: (?P<time>[0-9.]+)", line)
        if start_match:
            current_start = float(start_match.group("time"))
            continue

        end_match = re.search(r"silence_end: (?P<time>[0-9.]+)", line)
        if end_match and current_start is not None:
            silences.append((current_start, float(end_match.group("time"))))
            current_start = None

    return silences


def speech_segments_from_silences(silences: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    segments: list[tuple[float, float]] = []
    cursor = 0.0

    for silence_start, silence_end in silences:
        if silence_start - cursor >= MIN_SEGMENT_SECONDS:
            segments.append((cursor, silence_start))
        cursor = max(cursor, silence_end)

    if duration - cursor >= MIN_SEGMENT_SECONDS:
        segments.append((cursor, duration))

    if not segments and duration > 0:
        return [(0.0, duration)]

    return segments


def split_long_segments(segments: list[tuple[float, float]], max_seconds: float) -> list[tuple[float, float]]:
    bounded: list[tuple[float, float]] = []

    for start, end in segments:
        cursor = start
        while end - cursor > max_seconds:
            bounded.append((cursor, cursor + max_seconds))
            cursor += max_seconds
        if end - cursor >= MIN_SEGMENT_SECONDS:
            bounded.append((cursor, end))

    return bounded


def normalize_segments(payload: object) -> list[dict]:
    if not isinstance(payload, list) or not payload:
        raise ValueError("At least one segment is required.")

    segments: list[dict] = []
    for index, segment in enumerate(payload, start=1):
        if not isinstance(segment, dict):
            raise ValueError("Invalid segment payload.")

        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        if end <= start:
            raise ValueError("Segment end must be greater than start.")

        segments.append({
            "index": int(segment.get("index", index)),
            "start": start,
            "end": end,
        })

    return segments


def normalize_text_segments(payload: object) -> list[dict]:
    segments = normalize_segments(payload)

    for index, segment in enumerate(segments):
        original = payload[index] if isinstance(payload, list) else {}
        if not isinstance(original, dict):
            raise ValueError("Invalid segment payload.")
        segment["text"] = str(original.get("text", "")).strip()

    return segments


def transcribe_segments(audio_path: Path, segments: list[dict], language_code: str, progress_callback=None, job_id: str | None = None, runtime: dict | None = None) -> list[dict]:
    """Transcribe all segments in one worker invocation (model loaded once)."""
    selected_runtime = runtime or WHISPER_RUNTIME
    worker_python = _WHISPER_VENV_PYTHON
    use_worker = (
        selected_runtime.get("backend") == "faster-whisper"
        and selected_runtime.get("available")
        and Path(worker_python).exists()
        and TRANSCRIBE_WORKER.exists()
    )

    if use_worker:
        return _transcribe_segments_worker(audio_path, segments, language_code, progress_callback, worker_python, job_id, selected_runtime)
    else:
        return _transcribe_segments_cli(audio_path, segments, language_code, progress_callback, job_id)


def _transcribe_segments_worker(
    audio_path: Path,
    segments: list[dict],
    language_code: str,
    progress_callback,
    worker_python: str,
    job_id: str | None,
    runtime: dict,
) -> list[dict]:
    """Use transcribe_worker.py (faster-whisper, model loaded once for all segments)."""
    work_dir = WORK_DIR / f"job-{uuid.uuid4().hex}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        segments_file = work_dir / "segments_in.json"
        out_file = work_dir / "segments_out.json"
        segments_file.write_text(json.dumps(segments), encoding="utf-8")

        run_job_command(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--audio", str(audio_path),
                "--language", language_code or "",
                "--segments", str(segments_file),
                "--out", str(out_file),
                "--model", runtime["model"],
                "--device", runtime["device"],
                "--compute-type", runtime["computeType"],
            ],
            job_id=job_id,
        )
        results = json.loads(out_file.read_text(encoding="utf-8"))
        if progress_callback:
            progress_callback(len(results), len(results))
        return results
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _transcribe_segments_cli(
    audio_path: Path,
    segments: list[dict],
    language_code: str,
    progress_callback,
    job_id: str | None,
) -> list[dict]:
    """Fallback: openai-whisper CLI, one subprocess per segment."""
    results: list[dict] = []
    segment_dir = WORK_DIR / f"segments-{uuid.uuid4().hex}"
    segment_dir.mkdir(parents=True, exist_ok=True)

    try:
        for completed, segment in enumerate(segments, start=1):
            if job_id is not None:
                ensure_job_not_cancelled(job_id)
            segment_audio_path = segment_dir / f"segment-{segment['index']:05d}.wav"
            slice_audio(audio_path, segment_audio_path, segment["start"], segment["end"], job_id)
            text = transcribe_audio_file(segment_audio_path, language_code, segment_dir, job_id)
            results.append({
                **segment,
                "start": round(segment["start"], 3),
                "end": round(segment["end"], 3),
                "text": text,
            })
            if progress_callback:
                progress_callback(completed, len(segments))
    finally:
        shutil.rmtree(segment_dir, ignore_errors=True)

    return results


def translate_segments(segments: list[dict], source_language: str, target_language: str, progress_callback=None, max_workers: int = 1, job_id: str | None = None) -> list[dict]:
    if not source_language or not target_language:
        raise ValueError("Source and target languages are required.")
    if source_language == target_language:
        raise ValueError("Source and target languages must differ.")

    translated: list[dict | None] = [None] * len(segments)

    def translate_one(position: int, segment: dict) -> tuple[int, dict]:
        if job_id is not None:
            ensure_job_not_cancelled(job_id)
            translated_text = translate_text(segment.get("text", ""), source_language, target_language, job_id)
        else:
            translated_text = translate_text(segment.get("text", ""), source_language, target_language)
        return position, {
            **segment,
            "translatedText": translated_text,
        }

    if max_workers <= 1 or len(segments) <= 1:
        for position, segment in enumerate(segments):
            _, translated_segment = translate_one(position, segment)
            translated[position] = translated_segment
            if progress_callback:
                progress_callback(position + 1, len(segments))
    else:
        completed = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(translate_one, position, segment) for position, segment in enumerate(segments)]
            try:
                for future in as_completed(futures):
                    position, translated_segment = future.result()
                    translated[position] = translated_segment
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, len(segments))
            except JobCancelled:
                for future in futures:
                    future.cancel()
                raise

    return [segment for segment in translated if segment is not None]


def translate_text(text: str, source_language: str, target_language: str, job_id: str | None = None) -> str:
    if not text.strip():
        return ""

    result = run_job_command(
        [
            ARGOS_COMMAND,
            "-f",
            source_language,
            "-t",
            target_language,
        ],
        job_id=job_id,
        input=text,
    )
    return result.stdout.strip()


def put_job(job_id: str, values: dict) -> None:
    with JOBS_LOCK:
        JOBS[job_id] = values


def register_job_future(job_id: str, future: object) -> None:
    with JOBS_LOCK:
        JOB_FUTURES[job_id] = future


def register_job_process(job_id: str, process: subprocess.Popen) -> None:
    with JOBS_LOCK:
        JOB_PROCESSES.setdefault(job_id, set()).add(process)


def unregister_job_process(job_id: str, process: subprocess.Popen) -> None:
    with JOBS_LOCK:
        processes = JOB_PROCESSES.get(job_id)
        if not processes:
            return
        processes.discard(process)
        if not processes:
            JOB_PROCESSES.pop(job_id, None)


def cleanup_job_runtime(job_id: str) -> None:
    with JOBS_LOCK:
        JOB_FUTURES.pop(job_id, None)
        JOB_PROCESSES.pop(job_id, None)


def update_job(job_id: str, **values) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        if job.get("status") == "cancelled":
            raise JobCancelled()
        job.update(values)
        job["updatedAt"] = time.time()


def ensure_job_not_cancelled(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job and job.get("status") == "cancelled":
            raise JobCancelled()


def is_job_cancelled(job_id: str) -> bool:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return bool(job and job.get("status") == "cancelled")


def cancel_subtitle_job(job_id: str) -> dict | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return None

        if job.get("status") not in TERMINAL_JOB_STATUSES:
            job.update({
                "status": "cancelled",
                "stage": "cancelled",
                "message": "Subtitle generation cancelled.",
                "error": "",
                "updatedAt": time.time(),
            })

        future = JOB_FUTURES.get(job_id)
        processes = list(JOB_PROCESSES.get(job_id, set()))

    if future is not None:
        future.cancel()
    for process in processes:
        terminate_process(process)

    return job_snapshot(job_id)


def job_snapshot(job_id: str) -> dict | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return None
        return dict(job)


def mark_job_cancelled(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job.get("status") in {"succeeded", "failed"}:
            return
        job.update({
            "status": "cancelled",
            "stage": "cancelled",
            "message": "Subtitle generation cancelled.",
            "error": "",
            "updatedAt": time.time(),
        })


def terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except Exception:
        process.terminate()

    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        except Exception:
            process.kill()
        process.wait(timeout=2)


def run_job_command(command: list[str], *, job_id: str | None = None, input: str | None = None) -> subprocess.CompletedProcess:
    if job_id is None:
        return subprocess.run(command, input=input, check=True, capture_output=True, text=True)

    ensure_job_not_cancelled(job_id)
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as stdout_file:
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as stderr_file:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE if input is not None else None,
                stdout=stdout_file,
                stderr=stderr_file,
                text=True,
                start_new_session=True,
            )
            register_job_process(job_id, process)
            try:
                if input is not None and process.stdin is not None:
                    try:
                        process.stdin.write(input)
                        process.stdin.close()
                    except BrokenPipeError:
                        pass

                while True:
                    ensure_job_not_cancelled(job_id)
                    try:
                        return_code = process.wait(timeout=0.25)
                        break
                    except subprocess.TimeoutExpired:
                        continue

                stdout_file.seek(0)
                stderr_file.seek(0)
                stdout = stdout_file.read()
                stderr = stderr_file.read()
                ensure_job_not_cancelled(job_id)

                if return_code:
                    raise subprocess.CalledProcessError(return_code, command, output=stdout, stderr=stderr)

                return subprocess.CompletedProcess(command, return_code, stdout, stderr)
            except JobCancelled:
                terminate_process(process)
                raise
            finally:
                unregister_job_process(job_id, process)


def command_error_summary(error: subprocess.CalledProcessError) -> str:
    detail = (error.stderr or error.output or str(error)).strip()
    return detail.splitlines()[-1] if detail else str(error)


def truncate_message(message: str, max_length: int = 180) -> str:
    if len(message) <= max_length:
        return message
    return f"{message[:max_length - 1]}…"


def run_subtitle_job(job_id: str, audio_path: Path, segments: list[dict], source_language: str, target_language: str) -> None:
    try:
        ensure_job_not_cancelled(job_id)
        update_job(
            job_id,
            status="running",
            stage="transcribing",
            progress=1,
            message="Transcribing segmented audio.",
        )

        def transcription_progress(done: int, total: int) -> None:
            ensure_job_not_cancelled(job_id)
            update_job(
                job_id,
                progress=round((done / total) * 55),
                message=f"Transcribed {done}/{total} segments.",
            )

        try:
            transcribed_segments = transcribe_segments(
                audio_path,
                segments,
                source_language,
                transcription_progress,
                job_id,
                dict(WHISPER_RUNTIME),
            )
        except subprocess.CalledProcessError as error:
            if WHISPER_RUNTIME.get("device") != "cuda":
                raise
            ensure_job_not_cancelled(job_id)
            fallback_reason = command_error_summary(error)
            if not CPU_WHISPER_RUNTIME.get("available"):
                raise RuntimeError(
                    f"GPU transcription failed and CPU fallback is unavailable. "
                    f"GPU error: {fallback_reason}. "
                    f"CPU fallback error: {CPU_WHISPER_RUNTIME.get('fallbackReason', 'unknown')}"
                ) from error
            update_job(
                job_id,
                progress=1,
                message=truncate_message(
                    f"GPU {WHISPER_RUNTIME.get('model', WHISPER_GPU_MODEL)}/{WHISPER_RUNTIME.get('computeType', WHISPER_GPU_COMPUTE_TYPE)} "
                    f"failed: {fallback_reason}. Retrying with CPU {CPU_WHISPER_RUNTIME.get('model', WHISPER_CPU_MODEL)}."
                ),
                error=fallback_reason,
            )
            cpu_runtime = {
                **CPU_WHISPER_RUNTIME,
                "fallbackReason": f"Runtime fallback after CUDA failure: {fallback_reason}",
            }
            transcribed_segments = transcribe_segments(
                audio_path,
                segments,
                source_language,
                transcription_progress,
                job_id,
                cpu_runtime,
            )
        ensure_job_not_cancelled(job_id)
        update_job(
            job_id,
            stage="translating",
            progress=55,
            message="Translating transcribed segments.",
            segments=transcribed_segments,
        )

        def translation_progress(done: int, total: int) -> None:
            ensure_job_not_cancelled(job_id)
            update_job(
                job_id,
                progress=55 + round((done / total) * 35),
                message=f"Translated {done}/{total} segments.",
            )

        translated_segments = translate_segments(
            transcribed_segments,
            source_language,
            target_language,
            translation_progress,
            max_workers=TRANSLATION_WORKERS,
            job_id=job_id,
        )
        ensure_job_not_cancelled(job_id)
        update_job(
            job_id,
            status="succeeded",
            stage="ready",
            progress=90,
            message="Transcription and translation completed.",
            segments=translated_segments,
        )
    except JobCancelled:
        mark_job_cancelled(job_id)
    except Exception as error:
        if is_job_cancelled(job_id):
            mark_job_cancelled(job_id)
            return
        update_job(
            job_id,
            status="failed",
            stage="failed",
            progress=0,
            message=str(error),
            error=str(error),
        )
    finally:
        cleanup_job_runtime(job_id)


def slice_audio(audio_path: Path, output_path: Path, start: float, end: float, job_id: str | None = None) -> None:
    run_job_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        job_id=job_id,
    )


def transcribe_audio_file(audio_path: Path, language_code: str, output_dir: Path, job_id: str | None = None) -> str:
    """CLI fallback: openai-whisper one file at a time."""
    whisper_cmd = shutil.which("whisper") or "whisper"
    command = [
        whisper_cmd,
        str(audio_path),
        "--model", "base",
        "--device", "cpu",
        "--output_format", "txt",
        "--output_dir", str(output_dir),
    ]
    if language_code:
        command.extend(["--language", language_code])

    run_job_command(command, job_id=job_id)
    text_path = output_dir / f"{audio_path.stem}.txt"
    return text_path.read_text(encoding="utf-8").strip()


def main() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    _detect_whisper_runtime()
    server = ThreadingHTTPServer((HOST, PORT), LocalServiceHandler)
    print(f"XoloLingua local service listening on http://{HOST}:{PORT}")
    print(f"Audio work directory: {WORK_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
