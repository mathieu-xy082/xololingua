"""Subtitle job orchestration and cancellable subprocess handling."""

from __future__ import annotations

import os
import signal
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

from . import runtime as whisper_runtime
from .settings import (
    SUBTITLE_JOB_WORKERS,
    TRANSLATION_WORKERS,
    WHISPER_CPU_COMPUTE_TYPE,
    WHISPER_CPU_MODEL,
    WHISPER_GPU_COMPUTE_TYPE,
    WHISPER_GPU_MODEL,
)

JOBS: dict[str, dict] = {}
JOB_FUTURES: dict[str, object] = {}
JOB_PROCESSES: dict[str, set[subprocess.Popen]] = {}
JOBS_LOCK = Lock()
JOBS_EXECUTOR = ThreadPoolExecutor(max_workers=SUBTITLE_JOB_WORKERS)
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}


class JobCancelled(Exception):
    """Raised when a subtitle job is cancelled while work is running."""


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


def list_job_snapshots() -> list[dict]:
    with JOBS_LOCK:
        return [
            dict(job)
            for job in sorted(
                JOBS.values(),
                key=lambda item: item.get("createdAt", 0),
                reverse=True,
            )
        ]


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
    from .transcription import transcribe_segments
    from .translation import translate_segments

    try:
        ensure_job_not_cancelled(job_id)
        selected_runtime = whisper_runtime.preferred_job_runtime()
        runtime_device = selected_runtime.get("device", "cpu")
        runtime_model = selected_runtime.get("model", WHISPER_CPU_MODEL if runtime_device == "cpu" else WHISPER_GPU_MODEL)
        update_job(
            job_id,
            status="running",
            stage="transcribing",
            progress=1,
            message=(
                f"Transcribing segmented audio on "
                f"{'GPU' if runtime_device == 'cuda' else 'CPU'} "
                f"({runtime_model})."
            ),
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
                selected_runtime,
            )
        except subprocess.CalledProcessError as error:
            if selected_runtime.get("device") != "cuda":
                raise
            ensure_job_not_cancelled(job_id)
            fallback_reason = command_error_summary(error)
            if not whisper_runtime.CPU_WHISPER_RUNTIME.get("available"):
                raise RuntimeError(
                    f"GPU transcription failed and CPU fallback is unavailable. "
                    f"GPU error: {fallback_reason}. "
                    f"CPU fallback error: {whisper_runtime.CPU_WHISPER_RUNTIME.get('fallbackReason', 'unknown')}"
                ) from error
            update_job(
                job_id,
                progress=1,
                message=truncate_message(
                    f"GPU {selected_runtime.get('model', WHISPER_GPU_MODEL)}/{selected_runtime.get('computeType', WHISPER_GPU_COMPUTE_TYPE)} "
                    f"failed: {fallback_reason}. Retrying with CPU {whisper_runtime.CPU_WHISPER_RUNTIME.get('model', WHISPER_CPU_MODEL)}."
                ),
                error=fallback_reason,
            )
            cpu_runtime = {
                **whisper_runtime.CPU_WHISPER_RUNTIME,
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
