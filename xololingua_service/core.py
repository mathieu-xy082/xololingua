"""Compatibility exports for the local XoloLingua service.

New code should import the focused modules directly:
settings, runtime, media, transcription, translation, jobs, or http_api.
"""

from __future__ import annotations

from .http_api import LocalServiceHandler, main
from .jobs import (
    JOBS,
    JOBS_EXECUTOR,
    JOBS_LOCK,
    JOB_FUTURES,
    JOB_PROCESSES,
    TERMINAL_JOB_STATUSES,
    JobCancelled,
    cancel_subtitle_job,
    cleanup_job_runtime,
    command_error_summary,
    ensure_job_not_cancelled,
    is_job_cancelled,
    job_snapshot,
    mark_job_cancelled,
    put_job,
    register_job_future,
    register_job_process,
    run_job_command,
    run_subtitle_job,
    terminate_process,
    truncate_message,
    unregister_job_process,
    update_job,
)
from .media import (
    detect_silences,
    extract_audio,
    normalize_segments,
    normalize_text_segments,
    probe_duration,
    segment_audio,
    speech_segments_from_silences,
    split_long_segments,
)
from .runtime import CPU_WHISPER_RUNTIME, WHISPER_RUNTIME, detect_whisper_runtime
from .settings import *
from .transcription import (
    slice_audio,
    transcribe_audio_file,
    transcribe_segments,
)
from .translation import translate_segments, translate_text

