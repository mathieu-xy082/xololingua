"""Segment translation helpers."""

from __future__ import annotations

import threading
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

from .settings import ARGOS_COMMAND


TRANSLATION_BATCH_SIZE = 8
PIVOT_LANGUAGE = "en"
_TRANSLATION_CACHE_LOCK = threading.Lock()
_TRANSLATION_CACHE: dict[tuple[str, str], object] = {}

try:
    import argostranslate.translate as _argos_translate
except ImportError:
    _argos_translate = None


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

    translator = get_translator(source_language, target_language)

    input_text = "\n".join(texts[index] for index in non_empty_positions)
    translated_lines = translator(input_text, source_language, target_language, job_id).splitlines()

    if len(translated_lines) != len(non_empty_positions):
        translated_lines = [
            translator(texts[index], source_language, target_language, job_id).strip()
            for index in non_empty_positions
        ]

    translated = [""] * len(texts)
    for position, translated_text in zip(non_empty_positions, translated_lines):
        translated[position] = translated_text.strip()
    return translated


def translation_backend_available() -> bool:
    return _argos_translate is not None or bool(shutil.which(ARGOS_COMMAND))


def get_supported_pairs() -> list[dict[str, str]]:
    """Return direct and English-pivot translation pairs available from Argos."""
    if _argos_translate is None:
        return []

    direct_pairs = set()
    for language in _argos_translate.get_installed_languages():
        for translation in language.translations_from:
            source = translation.from_lang.code
            target = translation.to_lang.code
            if source != target:
                direct_pairs.add((source, target))

    pairs = set(direct_pairs)
    into_pivot = {source for source, target in direct_pairs if target == PIVOT_LANGUAGE}
    from_pivot = {target for source, target in direct_pairs if source == PIVOT_LANGUAGE}
    for source in into_pivot:
        for target in from_pivot:
            if source != target:
                pairs.add((source, target))

    return [
        {"source": source, "target": target}
        for source, target in sorted(pairs)
    ]


def get_translator(source_language: str, target_language: str):
    cache_key = (source_language, target_language)
    with _TRANSLATION_CACHE_LOCK:
        translator = _TRANSLATION_CACHE.get(cache_key)
        if translator is not None:
            return translator

        translator = _build_argos_python_translator(source_language, target_language)
        if translator is None:
            translator = _translate_text_block_cli

        _TRANSLATION_CACHE[cache_key] = translator
        return translator


def _build_argos_python_translator(source_language: str, target_language: str):
    direct_translator = _build_direct_argos_python_translator(source_language, target_language)
    if direct_translator is not None:
        return direct_translator

    if source_language == PIVOT_LANGUAGE or target_language == PIVOT_LANGUAGE:
        return None

    source_to_pivot = _build_direct_argos_python_translator(source_language, PIVOT_LANGUAGE)
    pivot_to_target = _build_direct_argos_python_translator(PIVOT_LANGUAGE, target_language)
    if source_to_pivot is None or pivot_to_target is None:
        return None

    def run(text: str, _source_language: str, _target_language: str, job_id: str | None = None) -> str:
        pivot_text = source_to_pivot(text, source_language, PIVOT_LANGUAGE, job_id)
        return pivot_to_target(pivot_text, PIVOT_LANGUAGE, target_language, job_id)

    return run


def _build_direct_argos_python_translator(source_language: str, target_language: str):
    if _argos_translate is None:
        return None

    installed_languages = _argos_translate.get_installed_languages()
    from_language = next((language for language in installed_languages if language.code == source_language), None)
    to_language = next((language for language in installed_languages if language.code == target_language), None)
    if from_language is None or to_language is None:
        return None

    translation = from_language.get_translation(to_language)
    if translation is None:
        return None

    def run(text: str, _source_language: str, _target_language: str, _job_id: str | None = None) -> str:
        return translation.translate(text)

    return run


def _translate_text_block_cli(text: str, source_language: str, target_language: str, job_id: str | None = None) -> str:
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
