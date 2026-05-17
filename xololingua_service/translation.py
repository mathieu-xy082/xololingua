"""Segment translation helpers."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .settings import ARGOS_COMMAND

def translate_segments(segments: list[dict], source_language: str, target_language: str, progress_callback=None, max_workers: int = 1, job_id: str | None = None) -> list[dict]:
    from .jobs import JobCancelled, ensure_job_not_cancelled

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
    from .jobs import run_job_command

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
