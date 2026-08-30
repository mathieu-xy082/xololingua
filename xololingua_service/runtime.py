"""Whisper runtime probing."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from .settings import (
    TRANSCRIBE_WORKER,
    WHISPER_CPU_COMPUTE_TYPE,
    WHISPER_CPU_MODEL,
    WHISPER_DEVICE_CHOICE,
    WHISPER_GPU_COMPUTE_TYPE,
    WHISPER_GPU_MODEL,
    WHISPER_PYTHON,
)

GPU_WARMUP_ATTEMPTS = max(1, int(os.environ.get("XOLOLINGUA_GPU_WARMUP_ATTEMPTS", "3")))
GPU_WARMUP_DELAY_SECONDS = max(0.0, float(os.environ.get("XOLOLINGUA_GPU_WARMUP_DELAY_SECONDS", "2")))

WHISPER_RUNTIME: dict = {
    "backend": "unknown",
    "device": "cpu",
    "model": "base",
    "computeType": "int8",
    "cudaDevices": 0,
    "nvidiaSmi": False,
    "nvidiaSmiError": "",
    "fallbackReason": "",
    "requestedDevice": WHISPER_DEVICE_CHOICE,
    "available": False,
}

CPU_WHISPER_RUNTIME: dict = {
    "backend": "faster-whisper",
    "device": "cpu",
    "model": WHISPER_CPU_MODEL,
    "computeType": WHISPER_CPU_COMPUTE_TYPE,
    "cudaDevices": 0,
    "nvidiaSmi": False,
    "nvidiaSmiError": "",
    "fallbackReason": "Runtime fallback requested.",
    "requestedDevice": WHISPER_DEVICE_CHOICE,
    "available": True,
}


def probe_whisper_runtime(device_choice: str | None = None) -> dict:
    worker_python = WHISPER_PYTHON
    requested_device = device_choice or WHISPER_DEVICE_CHOICE
    result = subprocess.run(
        [
            worker_python,
            str(TRANSCRIBE_WORKER),
            "--probe",
            "--device",
            requested_device,
            "--gpu-model",
            WHISPER_GPU_MODEL,
            "--cpu-model",
            WHISPER_CPU_MODEL,
            "--gpu-compute-type",
            WHISPER_GPU_COMPUTE_TYPE,
            "--cpu-compute-type",
            WHISPER_CPU_COMPUTE_TYPE,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return json.loads(result.stdout.strip())


def preferred_job_runtime() -> dict:
    if WHISPER_DEVICE_CHOICE == "cpu":
        return dict(CPU_WHISPER_RUNTIME)
    if Path(WHISPER_PYTHON).exists() and TRANSCRIBE_WORKER.exists():
        try:
            runtime = probe_whisper_runtime("cuda" if WHISPER_DEVICE_CHOICE == "auto" else WHISPER_DEVICE_CHOICE)
            if runtime.get("available"):
                return runtime
        except Exception:
            pass
    return dict(CPU_WHISPER_RUNTIME)


def detect_whisper_runtime() -> None:
    """Probe the transcribe worker for GPU availability and populate WHISPER_RUNTIME."""
    global WHISPER_RUNTIME, CPU_WHISPER_RUNTIME
    worker_python = WHISPER_PYTHON
    if not Path(worker_python).exists():
        print(f"[whisper] venv python not found at {worker_python}, falling back to system whisper CLI")
        WHISPER_RUNTIME = {"backend": "whisper-cli", "device": "cpu", "model": "base",
                           "computeType": "n/a", "cudaDevices": 0, "available": bool(shutil.which("whisper"))}
        return
    if not TRANSCRIBE_WORKER.exists():
        print(f"[whisper] transcribe_worker.py not found at {TRANSCRIBE_WORKER}")
        WHISPER_RUNTIME["available"] = False
        return
    try:
        runtime = _probe_with_gpu_warmup()
        WHISPER_RUNTIME = runtime
        CPU_WHISPER_RUNTIME = runtime if runtime.get("device") == "cpu" else _probe_cpu_whisper_runtime(worker_python)
        device_label = f"CUDA ({runtime.get('cudaDevices', 0)} GPU)" if runtime["device"] == "cuda" else "CPU"
        print(f"[whisper] faster-whisper ready — model={runtime['model']} device={device_label} compute={runtime['computeType']}")
        if runtime.get("fallbackReason"):
            print(f"[whisper] fallback reason: {runtime['fallbackReason']}")
        if runtime.get("device") == "cuda" and not CPU_WHISPER_RUNTIME.get("available"):
            print(f"[whisper] CPU fallback unavailable: {CPU_WHISPER_RUNTIME.get('fallbackReason', 'unknown')}")
    except Exception as exc:
        print(f"[whisper] probe failed ({exc}), falling back to whisper CLI")
        WHISPER_RUNTIME = {"backend": "whisper-cli", "device": "cpu", "model": "base",
                           "computeType": "n/a", "cudaDevices": 0, "available": bool(shutil.which("whisper")),
                           "nvidiaSmi": False, "nvidiaSmiError": "", "fallbackReason": str(exc),
                           "requestedDevice": WHISPER_DEVICE_CHOICE}
        CPU_WHISPER_RUNTIME = WHISPER_RUNTIME


def _probe_with_gpu_warmup() -> dict:
    """Wake the GPU and retry the real CUDA probe before selecting CPU."""
    if WHISPER_DEVICE_CHOICE == "cpu":
        print("[whisper] GPU warmup skipped — CPU explicitly requested")
        return probe_whisper_runtime("cpu")

    last_runtime: dict | None = None
    for attempt in range(1, GPU_WARMUP_ATTEMPTS + 1):
        print(f"[whisper] GPU warmup attempt {attempt}/{GPU_WARMUP_ATTEMPTS}: querying NVIDIA runtime", flush=True)
        _wake_gpu()
        try:
            runtime = probe_whisper_runtime("cuda" if WHISPER_DEVICE_CHOICE == "auto" else WHISPER_DEVICE_CHOICE)
            last_runtime = runtime
            if runtime.get("device") == "cuda" and runtime.get("available"):
                print(
                    f"[whisper] faster-whisper mini job succeeded — model loaded and test inference completed on CUDA (attempt {attempt})",
                    flush=True,
                )
                return runtime
            print(f"[whisper] GPU warmup probe did not select CUDA: {runtime.get('fallbackReason', 'unknown reason')}", flush=True)
        except Exception as exc:
            print(f"[whisper] GPU warmup probe failed on attempt {attempt}: {exc}", flush=True)
        if attempt < GPU_WARMUP_ATTEMPTS:
            print(f"[whisper] waiting {GPU_WARMUP_DELAY_SECONDS:g}s before retry", flush=True)
            time.sleep(GPU_WARMUP_DELAY_SECONDS)

    if last_runtime is not None:
        return last_runtime
    return probe_whisper_runtime("cpu")


def _wake_gpu() -> None:
    """Issue a lightweight NVIDIA query to wake the device before CUDA init."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,pci.bus_id", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        detail = result.stdout.strip() or "device detected"
        print(f"[whisper] nvidia-smi ready: {detail}", flush=True)
    except Exception as exc:
        print(f"[whisper] nvidia-smi wake query failed: {exc}", flush=True)


def _probe_cpu_whisper_runtime(worker_python: str) -> dict:
    try:
        result = subprocess.run(
            [
                worker_python,
                str(TRANSCRIBE_WORKER),
                "--probe",
                "--device", "cpu",
                "--cpu-model", WHISPER_CPU_MODEL,
                "--cpu-compute-type", WHISPER_CPU_COMPUTE_TYPE,
            ],
            check=True, capture_output=True, text=True, timeout=120,
        )
        return json.loads(result.stdout.strip())
    except Exception as exc:
        return {
            **CPU_WHISPER_RUNTIME,
            "available": False,
            "fallbackReason": str(exc),
        }
