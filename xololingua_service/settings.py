"""Configuration for the local XoloLingua service."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

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
WHISPER_GPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_GPU_MODEL", "small")
WHISPER_CPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_CPU_MODEL", "base")
WHISPER_GPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_GPU_COMPUTE_TYPE", "float16")
WHISPER_CPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_CPU_COMPUTE_TYPE", "int8")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRANSCRIBE_WORKER = PROJECT_ROOT / "transcribe_worker.py"
WHISPER_PYTHON = os.environ.get("XOLOLINGUA_WHISPER_PYTHON", sys.executable)
