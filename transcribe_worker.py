#!/usr/bin/env python3
"""Faster-Whisper transcription worker.

Runs inside the project Python environment selected by local_service.py.
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
import os
import subprocess
import sys
from pathlib import Path


GPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_GPU_MODEL", "base")
CPU_MODEL = os.environ.get("XOLOLINGUA_WHISPER_CPU_MODEL", "base")
GPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_GPU_COMPUTE_TYPE", "float16")
CPU_COMPUTE_TYPE = os.environ.get("XOLOLINGUA_WHISPER_CPU_COMPUTE_TYPE", "int8")
DEVICE_CHOICE = os.environ.get("XOLOLINGUA_WHISPER_DEVICE", "auto")


# ---------------------------------------------------------------------------
# Runtime probe
# ---------------------------------------------------------------------------

def _probe(
    device_choice: str = DEVICE_CHOICE,
    gpu_model: str = GPU_MODEL,
    cpu_model: str = CPU_MODEL,
    gpu_compute_type: str = GPU_COMPUTE_TYPE,
    cpu_compute_type: str = CPU_COMPUTE_TYPE,
) -> dict:
    """Return a descriptor for the best loadable faster-whisper runtime."""
    try:
        import ctranslate2
        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:
        cuda_count = 0

    nvidia_smi = _nvidia_smi_status()
    requested_device = device_choice if device_choice in {"auto", "cuda", "cpu"} else "auto"
    diagnostics = {
        "cudaDevices": cuda_count,
        "nvidiaSmi": nvidia_smi["ok"],
        "nvidiaSmiError": nvidia_smi["error"],
        "requestedDevice": requested_device,
    }

    if requested_device != "cpu" and cuda_count > 0 and nvidia_smi["ok"]:
        gpu_runtime = {
            "backend": "faster-whisper",
            "device": "cuda",
            "model": gpu_model,
            "computeType": gpu_compute_type,
            "available": True,
            "fallbackReason": "",
            **diagnostics,
        }
        gpu_error = _validate_runtime(gpu_runtime)
        if not gpu_error:
            return gpu_runtime
        fallback_reason = f"CUDA runtime validation failed: {gpu_error}"
    elif requested_device == "cuda" and cuda_count <= 0:
        fallback_reason = "CUDA was requested, but no CUDA device was reported by ctranslate2."
    elif requested_device == "cuda" and not nvidia_smi["ok"]:
        fallback_reason = f"CUDA was requested, but nvidia-smi failed: {nvidia_smi['error']}"
    elif requested_device == "auto" and cuda_count <= 0:
        fallback_reason = "No CUDA device was reported by ctranslate2."
    elif requested_device == "auto" and not nvidia_smi["ok"]:
        fallback_reason = f"nvidia-smi failed: {nvidia_smi['error']}"
    else:
        fallback_reason = "CPU runtime requested."

    cpu_runtime = {
        "backend": "faster-whisper",
        "device": "cpu",
        "model": cpu_model,
        "computeType": cpu_compute_type,
        "available": True,
        "fallbackReason": fallback_reason,
        **diagnostics,
    }
    cpu_error = _validate_runtime(cpu_runtime)
    if cpu_error:
        cpu_runtime["available"] = False
        cpu_runtime["fallbackReason"] = f"{fallback_reason} CPU runtime validation failed: {cpu_error}"
    return cpu_runtime


def _nvidia_smi_status() -> dict:
    try:
        result = subprocess.run(
            ["nvidia-smi"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return {"ok": True, "error": "", "output": result.stdout.strip()}
    except Exception as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        return {"ok": False, "error": detail.strip(), "output": ""}


def _validate_runtime(runtime: dict) -> str:
    try:
        from faster_whisper import WhisperModel
        import tempfile

        model = WhisperModel(
            runtime["model"],
            device=runtime["device"],
            compute_type=runtime["computeType"],
        )
        with tempfile.TemporaryDirectory(prefix="xolo_probe_") as directory:
            probe_audio = Path(directory) / "probe.wav"
            _write_probe_audio(probe_audio)
            transcription_segments, _ = model.transcribe(
                str(probe_audio),
                beam_size=1,
                vad_filter=False,
            )
            list(transcription_segments)
        return ""
    except Exception as exc:
        return str(exc)


def _write_probe_audio(path: Path) -> None:
    import math
    import struct
    import wave

    sample_rate = 16000
    duration_seconds = 0.25
    amplitude = 0.05
    sample_count = int(sample_rate * duration_seconds)

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for index in range(sample_count):
            value = int(32767 * amplitude * math.sin(2 * math.pi * 440 * index / sample_rate))
            frames.extend(struct.pack("<h", value))
        wav.writeframes(bytes(frames))


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
    parser.add_argument("--model", default="", help="Whisper model to load")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default=DEVICE_CHOICE, help="Transcription device")
    parser.add_argument("--compute-type", default="", help="faster-whisper compute type")
    parser.add_argument("--gpu-model", default=GPU_MODEL, help="Preferred GPU model for probing")
    parser.add_argument("--cpu-model", default=CPU_MODEL, help="Fallback CPU model for probing")
    parser.add_argument("--gpu-compute-type", default=GPU_COMPUTE_TYPE, help="Preferred GPU compute type")
    parser.add_argument("--cpu-compute-type", default=CPU_COMPUTE_TYPE, help="Fallback CPU compute type")
    args = parser.parse_args()

    if args.probe:
        print(json.dumps(_probe(args.device, args.gpu_model, args.cpu_model, args.gpu_compute_type, args.cpu_compute_type)))
        return

    if not args.audio or not args.segments or not args.out:
        parser.error("--audio, --segments, and --out are required for transcription")

    if not args.model or not args.device or not args.compute_type:
        parser.error("--model, --device, and --compute-type are required for transcription")

    runtime = {
        "backend": "faster-whisper",
        "model": args.model,
        "device": args.device,
        "computeType": args.compute_type,
    }
    segments = json.loads(args.segments.read_text(encoding="utf-8"))
    results = _transcribe(args.audio, args.language, segments, runtime)
    args.out.write_text(json.dumps(results), encoding="utf-8")


if __name__ == "__main__":
    main()
