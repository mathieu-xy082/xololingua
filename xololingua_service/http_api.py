"""HTTP API for the local XoloLingua service."""

from __future__ import annotations

import cgi
import json
import re
import shutil
import subprocess
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import runtime as whisper_runtime
from .jobs import (
    JOBS_EXECUTOR,
    cancel_subtitle_job,
    job_snapshot,
    list_job_snapshots,
    put_job,
    register_job_future,
    run_subtitle_job,
)
from .media import extract_audio, normalize_segments, normalize_text_segments, probe_duration, segment_audio
from .settings import ARGOS_COMMAND, HOST, MAX_DURATION_SECONDS, PORT, WHISPER_CPU_COMPUTE_TYPE, WHISPER_CPU_MODEL, WHISPER_DEVICE_CHOICE, WORK_DIR
from .transcription import transcribe_segments
from .translation import translate_segments

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
                "whisper": whisper_runtime.WHISPER_RUNTIME.get("available", False),
                "whisperBackend": whisper_runtime.WHISPER_RUNTIME.get("backend", "unknown"),
                "whisperModel": whisper_runtime.WHISPER_RUNTIME.get("model", "?"),
                "whisperDevice": whisper_runtime.WHISPER_RUNTIME.get("device", "?"),
                "whisperComputeType": whisper_runtime.WHISPER_RUNTIME.get("computeType", "?"),
                "whisperCudaDevices": whisper_runtime.WHISPER_RUNTIME.get("cudaDevices", 0),
                "whisperRequestedDevice": whisper_runtime.WHISPER_RUNTIME.get("requestedDevice", WHISPER_DEVICE_CHOICE),
                "whisperFallbackReason": whisper_runtime.WHISPER_RUNTIME.get("fallbackReason", ""),
                "whisperCpuFallbackAvailable": whisper_runtime.CPU_WHISPER_RUNTIME.get("available", False),
                "whisperCpuFallbackModel": whisper_runtime.CPU_WHISPER_RUNTIME.get("model", WHISPER_CPU_MODEL),
                "whisperCpuFallbackComputeType": whisper_runtime.CPU_WHISPER_RUNTIME.get("computeType", WHISPER_CPU_COMPUTE_TYPE),
                "whisperCpuFallbackReason": whisper_runtime.CPU_WHISPER_RUNTIME.get("fallbackReason", ""),
                "nvidiaSmi": whisper_runtime.WHISPER_RUNTIME.get("nvidiaSmi", False),
                "nvidiaSmiError": whisper_runtime.WHISPER_RUNTIME.get("nvidiaSmiError", ""),
                "argosTranslate": bool(shutil.which(ARGOS_COMMAND)),
                "argosCommand": ARGOS_COMMAND,
            })
            return
        if self.path == "/api/subtitle-jobs":
            self.send_json({"jobs": list_job_snapshots()})
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
        if not whisper_runtime.WHISPER_RUNTIME.get("available"):
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
        if not whisper_runtime.WHISPER_RUNTIME.get("available"):
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


def main() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    whisper_runtime.detect_whisper_runtime()
    server = ThreadingHTTPServer((HOST, PORT), LocalServiceHandler)
    print(f"XoloLingua local service listening on http://{HOST}:{PORT}")
    print(f"Audio work directory: {WORK_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
