#!/usr/bin/env python3
"""Faster-Whisper transcription worker.

Runs inside the openai-whisper pipx venv (which has faster-whisper injected).
Called as a subprocess by local_service.py.

Usage:
  python transcribe_worker.py --probe
      Detect GPU/CPU capability and print a JSON runtime descriptor.

  python transcribe_worker.py --audio <wav> --language <code> --segments <json_file> --out <json_file>
      Transcribe all segments in <json_file> using a single model load.
      Writes a JSON array of transcribed segments to <out_file>.

Exit codes:
  0  success
  1  transcription error (error written to stderr)
  2  probe succeeded but CUDA not available (used as runtime signal)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Runtime probe
# ---------------------------------------------------------------------------

def _probe() -> dict:
    """Return a dict describing the best available compute backend."""
    try:
        import ctranslate2
        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:
        cuda_count = 0

    if cuda_count > 0:
        return {
            "backend": "faster-whisper",
            "device": "cuda",
            "model": "medium",
            "computeType": "float16",
            "cudaDevices": cuda_count,
        }
    else:
        return {
            "backend": "faster-whisper",
            "device": "cpu",
            "model": "base",
            "computeType": "int8",
            "cudaDevices": 0,
        }


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

def _transcribe(audio_path: Path, language_code: str, segments: list[dict], runtime: dict) -> list[dict]:
    from faster_whisper import WhisperModel
    import tempfile, shutil

    model = WhisperModel(
        runtime["model"],
        device=runtime["device"],
        compute_type=runtime["computeType"],
    )

    work_dir = Path(tempfile.mkdtemp(prefix="xolo_worker_"))
    results: list[dict] = []
    try:
        for segment in segments:
            seg_path = work_dir / f"seg_{segment['index']:05d}.wav"
            _slice_audio(audio_path, seg_path, segment["start"], segment["end"])

            transcription_segments, _ = model.transcribe(
                str(seg_path),
                language=language_code or None,
                beam_size=5,
                vad_filter=True,
            )
            text = " ".join(s.text.strip() for s in transcription_segments).strip()
            results.append({
                **segment,
                "text": text,
            })
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return results


def _slice_audio(audio_path: Path, out_path: Path, start: float, end: float) -> None:
    import subprocess
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", str(audio_path),
            "-ss", str(start),
            "-to", str(end),
            "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            str(out_path),
        ],
        check=True,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Faster-Whisper transcription worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true", help="Detect GPU/CPU runtime and print JSON")
    group.add_argument("--audio", type=Path, help="Path to mono 16kHz WAV file")
    parser.add_argument("--language", default="", help="ISO-639-1 language code (optional)")
    parser.add_argument("--segments", type=Path, help="JSON file with segment list")
    parser.add_argument("--out", type=Path, help="Output JSON file path")
    args = parser.parse_args()

    if args.probe:
        print(json.dumps(_probe()))
        return

    if not args.audio or not args.segments or not args.out:
        parser.error("--audio, --segments, and --out are required for transcription")

    runtime = _probe()
    segments = json.loads(args.segments.read_text(encoding="utf-8"))
    results = _transcribe(args.audio, args.language, segments, runtime)
    args.out.write_text(json.dumps(results), encoding="utf-8")


if __name__ == "__main__":
    main()
