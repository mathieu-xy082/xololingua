"""Segment translation helpers."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .settings import ARGOS_COMMAND


TRANSLATION_BATCH_SIZE = 8


def translate_segments(segments: list[dict], source_language: str, target_language: str, progress_callback=None, max_workers: int = 1, job_id: str | None = None) -> list[dict]:
    from .jobs import JobCancelled, ensure_job_not_cancelled

    if not source_language or not target_language:
        raise ValueError("Source and target languages are required.")
    if source_language == target_language:
        raise ValueError("Source and target languages must differ.")

    translated: list[dict | None] = [None] * len(segments)

    def translate_batch(batch: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
        if job_id is not None:
            ensure_job_not_cancelled(job_id)
        texts = [segment.get("text", "") for _, segment in batch]
        translated_texts = translate_texts(texts, source_language, target_language, job_id)
        return [
            (position, {**segment, "translatedText": translated_text})
            for (position, segment), translated_text in zip(batch, translated_texts)
        ]

    batches = [
        list(enumerate(segments))[index:index + TRANSLATION_BATCH_SIZE]
        for index in range(0, len(segments), TRANSLATION_BATCH_SIZE)
    ]

    if max_workers <= 1 or len(batches) <= 1:
        completed = 0
        for batch in batches:
            for position, translated_segment in translate_batch(batch):
                translated[position] = translated_segment
            completed += len(batch)
            if progress_callback:
                progress_callback(completed, len(segments))
    else:
        completed = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(translate_batch, batch) for batch in batches]
            try:
                for future in as_completed(futures):
                    translated_batch = future.result()
                    for position, translated_segment in translated_batch:
                        translated[position] = translated_segment
                    completed += len(translated_batch)
                    if progress_callback:
                        progress_callback(completed, len(segments))
            except JobCancelled:
                for future in futures:
                    future.cancel()
                raise

    return [segment for segment in translated if segment is not None]


def translate_text(text: str, source_language: str, target_language: str, job_id: str | None = None) -> str:
    return translate_texts([text], source_language, target_language, job_id)[0]


def translate_texts(texts: list[str], source_language: str, target_language: str, job_id: str | None = None) -> list[str]:
    if not texts:
        return []

    non_empty_positions = [index for index, text in enumerate(texts) if text.strip()]
    if not non_empty_positions:
        return [""] * len(texts)

    input_text = "\n".join(texts[index] for index in non_empty_positions)
    translated_lines = _translate_text_block(input_text, source_language, target_language, job_id).splitlines()

    if len(translated_lines) != len(non_empty_positions):
        translated_lines = [
            _translate_text_block(texts[index], source_language, target_language, job_id).strip()
            for index in non_empty_positions
        ]

    translated = [""] * len(texts)
    for position, translated_text in zip(non_empty_positions, translated_lines):
        translated[position] = translated_text.strip()
    return translated


def _translate_text_block(text: str, source_language: str, target_language: str, job_id: str | None = None) -> str:
    from .jobs import run_job_command

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
