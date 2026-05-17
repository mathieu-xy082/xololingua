"""Media probing, extraction, and speech segmentation."""

from __future__ import annotations

import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .settings import MAX_SEGMENT_SECONDS, MIN_SEGMENT_SECONDS, SILENCE_DURATION_SECONDS, SILENCE_NOISE

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


def extract_audio_clip(video_path: Path, audio_path: Path, start: float, duration: float) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-ss",
            f"{max(0.0, start):.3f}",
            "-t",
            f"{max(0.1, duration):.3f}",
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


def extract_audio_clips_parallel(
    video_path: Path,
    clip_specs: list[tuple[Path, float, float]],
    max_workers: int = 3,
) -> None:
    if not clip_specs:
        return
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(clip_specs)))) as executor:
        futures = [
            executor.submit(extract_audio_clip, video_path, audio_path, start, duration)
            for audio_path, start, duration in clip_specs
        ]
        for future in futures:
            future.result()


def language_detection_windows(duration: float, sample_count: int = 5, sample_seconds: float = 30.0) -> list[tuple[float, float]]:
    if duration <= 0:
        return []

    clip_duration = min(sample_seconds, duration)
    max_start = max(0.0, duration - clip_duration)
    if max_start == 0:
        return [(0.0, clip_duration)]

    if sample_count <= 1:
        return [(round(max_start / 2, 3), clip_duration)]

    starts = [
        round((max_start * index) / (sample_count - 1), 3)
        for index in range(sample_count)
    ]
    return [(start, clip_duration) for start in starts]


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
