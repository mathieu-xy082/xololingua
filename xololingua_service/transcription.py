"""Speech transcription helpers."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from . import runtime as whisper_runtime
from .settings import TRANSCRIBE_WORKER, WHISPER_PYTHON, WORK_DIR


def detect_audio_language(audio_path: Path, runtime: dict | None = None, job_id: str | None = None) -> dict:
    selected_runtime = runtime or whisper_runtime.WHISPER_RUNTIME
    worker_python = WHISPER_PYTHON
    use_worker = (
        selected_runtime.get("backend") == "faster-whisper"
        and selected_runtime.get("available")
        and Path(worker_python).exists()
        and TRANSCRIBE_WORKER.exists()
    )

    if not use_worker:
        raise RuntimeError("Language detection requires the faster-whisper worker runtime.")

    return _detect_audio_language_worker(audio_path, worker_python, job_id, selected_runtime)


def detect_audio_languages(audio_paths: list[Path], runtime: dict | None = None, job_id: str | None = None) -> list[dict]:
    selected_runtime = runtime or whisper_runtime.WHISPER_RUNTIME
    worker_python = WHISPER_PYTHON
    use_worker = (
        selected_runtime.get("backend") == "faster-whisper"
        and selected_runtime.get("available")
        and Path(worker_python).exists()
        and TRANSCRIBE_WORKER.exists()
    )

    if not use_worker:
        raise RuntimeError("Language detection requires the faster-whisper worker runtime.")

    return _detect_audio_languages_worker(audio_paths, worker_python, job_id, selected_runtime)


def _detect_audio_language_worker(audio_path: Path, worker_python: str, job_id: str | None, runtime: dict) -> dict:
    from .jobs import run_job_command

    work_dir = WORK_DIR / f"detect-{uuid.uuid4().hex}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        out_file = work_dir / "language_out.json"
        run_job_command(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--detect-language",
                "--audio", str(audio_path),
                "--out", str(out_file),
                "--model", runtime["model"],
                "--device", runtime["device"],
                "--compute-type", runtime["computeType"],
            ],
            job_id=job_id,
        )
        return json.loads(out_file.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _detect_audio_languages_worker(audio_paths: list[Path], worker_python: str, job_id: str | None, runtime: dict) -> list[dict]:
    from .jobs import run_job_command

    work_dir = WORK_DIR / f"detect-batch-{uuid.uuid4().hex}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        audio_list_file = work_dir / "audio_list.json"
        out_file = work_dir / "language_out.json"
        audio_list_file.write_text(
            json.dumps([str(path) for path in audio_paths]),
            encoding="utf-8",
        )
        run_job_command(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--detect-language",
                "--audio-list",
                str(audio_list_file),
                "--out",
                str(out_file),
                "--model",
                runtime["model"],
                "--device",
                runtime["device"],
                "--compute-type",
                runtime["computeType"],
            ],
            job_id=job_id,
        )
        return json.loads(out_file.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def transcribe_segments(audio_path: Path, segments: list[dict], language_code: str, progress_callback=None, job_id: str | None = None, runtime: dict | None = None) -> list[dict]:
    """Transcribe all segments in one worker invocation (model loaded once)."""
    selected_runtime = runtime or whisper_runtime.WHISPER_RUNTIME
    worker_python = WHISPER_PYTHON
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
    from .jobs import run_job_command

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
    from .jobs import ensure_job_not_cancelled

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


def slice_audio(audio_path: Path, output_path: Path, start: float, end: float, job_id: str | None = None) -> None:
    from .jobs import run_job_command

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
    from .jobs import run_job_command

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
