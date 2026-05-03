#!/usr/bin/env python3
"""Local development service for video audio preparation.

The browser cannot efficiently extract long MP4 audio without decoding large
buffers or shipping heavy WebAssembly. This service keeps that work on the
Ubuntu host and uses ffmpeg to create a segmentation-ready WAV file.
"""

from __future__ import annotations

import cgi
import json
import re
import shutil
import subprocess
import tempfile
import uuid
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8765
MAX_DURATION_SECONDS = int(2.5 * 60 * 60)
MAX_SEGMENT_SECONDS = 12.0
MIN_SEGMENT_SECONDS = 0.4
SILENCE_NOISE = "-35dB"
SILENCE_DURATION_SECONDS = 0.45
WORK_DIR = Path(tempfile.gettempdir()) / "xololingua"
WHISPER_COMMAND = os.environ.get("XOLOLINGUA_WHISPER_COMMAND", "whisper")
WHISPER_MODEL = os.environ.get("XOLOLINGUA_WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("XOLOLINGUA_WHISPER_DEVICE", "cpu")


class LocalServiceHandler(BaseHTTPRequestHandler):
    server_version = "XoloLinguaLocalService/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_json({
                "ok": True,
                "ffmpeg": bool(shutil.which("ffmpeg")),
                "ffprobe": bool(shutil.which("ffprobe")),
                "whisper": bool(shutil.which(WHISPER_COMMAND)),
                "whisperCommand": WHISPER_COMMAND,
                "whisperModel": WHISPER_MODEL,
                "whisperDevice": WHISPER_DEVICE,
            })
            return

        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown endpoint.")

    def do_POST(self) -> None:
        if self.path == "/api/extract-audio":
            self.handle_extract_audio()
            return
        if self.path == "/api/segment-audio":
            self.handle_segment_audio()
            return
        if self.path == "/api/transcribe-audio":
            self.handle_transcribe_audio()
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
        if not shutil.which(WHISPER_COMMAND):
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                f"Transcription engine not found. Install Whisper CLI or set XOLOLINGUA_WHISPER_COMMAND. Tried: {WHISPER_COMMAND}.",
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


def transcribe_segments(audio_path: Path, segments: list[dict], language_code: str) -> list[dict]:
    results: list[dict] = []
    segment_dir = WORK_DIR / f"segments-{uuid.uuid4().hex}"
    segment_dir.mkdir(parents=True, exist_ok=True)

    try:
        for segment in segments:
            segment_audio_path = segment_dir / f"segment-{segment['index']:05d}.wav"
            slice_audio(audio_path, segment_audio_path, segment["start"], segment["end"])
            text = transcribe_audio_file(segment_audio_path, language_code, segment_dir)
            results.append({
                **segment,
                "start": round(segment["start"], 3),
                "end": round(segment["end"], 3),
                "text": text,
            })
    finally:
        shutil.rmtree(segment_dir, ignore_errors=True)

    return results


def slice_audio(audio_path: Path, output_path: Path, start: float, end: float) -> None:
    subprocess.run(
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
        check=True,
        capture_output=True,
        text=True,
    )


def transcribe_audio_file(audio_path: Path, language_code: str, output_dir: Path) -> str:
    command = [
        WHISPER_COMMAND,
        str(audio_path),
        "--model",
        WHISPER_MODEL,
        "--device",
        WHISPER_DEVICE,
        "--output_format",
        "txt",
        "--output_dir",
        str(output_dir),
    ]
    if language_code:
        command.extend(["--language", language_code])

    subprocess.run(command, check=True, capture_output=True, text=True)
    text_path = output_dir / f"{audio_path.stem}.txt"
    return text_path.read_text(encoding="utf-8").strip()


def main() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), LocalServiceHandler)
    print(f"XoloLingua local service listening on http://{HOST}:{PORT}")
    print(f"Audio work directory: {WORK_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
