"""Unit tests for subtitle job lifecycle (no ffmpeg required)."""

import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import local_service
from xololingua_service import runtime, transcription, translation


class SubtitleJobTests(unittest.TestCase):
    def test_run_subtitle_job_updates_job_to_succeeded(self):
        job_id = "a" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "",
            "createdAt": 0,
            "updatedAt": 0,
            "segments": [],
            "error": "",
        })

        with mock.patch.object(transcription, "transcribe_segments", return_value=[{
            "index": 1,
            "start": 0.0,
            "end": 1.0,
            "text": "Bonjour.",
        }]):
            with mock.patch.object(translation, "translate_segments", return_value=[{
                "index": 1,
                "start": 0.0,
                "end": 1.0,
                "text": "Bonjour.",
                "translatedText": "Hello.",
            }]):
                local_service.run_subtitle_job(job_id, Path("/tmp/sample.wav"), [{"index": 1, "start": 0.0, "end": 1.0}], "fr", "en")

        snapshot = local_service.job_snapshot(job_id)
        self.assertEqual(snapshot["status"], "succeeded")
        self.assertEqual(snapshot["stage"], "ready")
        self.assertEqual(snapshot["segments"][0]["translatedText"], "Hello.")

    def test_run_subtitle_job_retries_cpu_after_cuda_failure(self):
        job_id = "e" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "",
            "createdAt": 0,
            "updatedAt": 0,
            "segments": [],
            "error": "",
        })
        cuda_runtime = {
            "backend": "faster-whisper",
            "available": True,
            "device": "cuda",
            "model": "base",
            "computeType": "float16",
            "cudaDevices": 1,
        }
        cpu_runtime = {
            "backend": "faster-whisper",
            "available": True,
            "device": "cpu",
            "model": "base",
            "computeType": "int8",
            "cudaDevices": 0,
        }
        transcribed = [{"index": 1, "start": 0.0, "end": 1.0, "text": "Bonjour."}]
        cuda_error = subprocess.CalledProcessError(1, ["worker"], stderr="CUDA failed")

        with mock.patch.dict(runtime.WHISPER_RUNTIME, cuda_runtime, clear=True):
            with mock.patch.dict(runtime.CPU_WHISPER_RUNTIME, cpu_runtime, clear=True):
                with mock.patch.object(runtime, "preferred_job_runtime", return_value=dict(cuda_runtime)):
                    with mock.patch.object(transcription, "transcribe_segments", side_effect=[cuda_error, transcribed]) as transcribe_segments:
                        with mock.patch.object(translation, "translate_segments", return_value=[{
                            "index": 1,
                            "start": 0.0,
                            "end": 1.0,
                            "text": "Bonjour.",
                            "translatedText": "Hello.",
                        }]):
                            local_service.run_subtitle_job(job_id, Path("/tmp/sample.wav"), [{"index": 1, "start": 0.0, "end": 1.0}], "fr", "en")

        self.assertEqual(transcribe_segments.call_args_list[0].args[5]["device"], "cuda")
        self.assertEqual(transcribe_segments.call_args_list[1].args[5]["device"], "cpu")
        snapshot = local_service.job_snapshot(job_id)
        self.assertEqual(snapshot["status"], "succeeded")
        self.assertEqual(snapshot["segments"][0]["translatedText"], "Hello.")

    def test_run_subtitle_job_fails_when_cuda_and_cpu_fallback_both_fail(self):
        job_id = "f" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "",
            "createdAt": 0,
            "updatedAt": 0,
            "segments": [],
            "error": "",
        })
        cuda_runtime = {
            "backend": "faster-whisper",
            "available": True,
            "device": "cuda",
            "model": "base",
            "computeType": "float16",
            "cudaDevices": 1,
        }
        cpu_runtime = {
            "backend": "faster-whisper",
            "available": False,
            "device": "cpu",
            "model": "base",
            "computeType": "int8",
            "fallbackReason": "base model missing",
        }
        cuda_error = subprocess.CalledProcessError(1, ["worker"], stderr="CUDA failed")

        with mock.patch.dict(runtime.WHISPER_RUNTIME, cuda_runtime, clear=True):
            with mock.patch.dict(runtime.CPU_WHISPER_RUNTIME, cpu_runtime, clear=True):
                with mock.patch.object(runtime, "preferred_job_runtime", return_value=dict(cuda_runtime)):
                    with mock.patch.object(transcription, "transcribe_segments", side_effect=cuda_error):
                        local_service.run_subtitle_job(job_id, Path("/tmp/sample.wav"), [{"index": 1, "start": 0.0, "end": 1.0}], "fr", "en")

        snapshot = local_service.job_snapshot(job_id)
        self.assertEqual(snapshot["status"], "failed")
        self.assertIn("CPU fallback is unavailable", snapshot["message"])

    def test_cancel_subtitle_job_prevents_queued_work_from_running(self):
        job_id = "b" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "",
            "createdAt": 0,
            "updatedAt": 0,
            "segments": [],
            "error": "",
        })

        local_service.cancel_subtitle_job(job_id)
        with mock.patch.object(transcription, "transcribe_segments") as transcribe_segments:
            local_service.run_subtitle_job(job_id, Path("/tmp/sample.wav"), [{"index": 1, "start": 0.0, "end": 1.0}], "fr", "en")

        transcribe_segments.assert_not_called()
        snapshot = local_service.job_snapshot(job_id)
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertEqual(snapshot["stage"], "cancelled")

    def test_cancel_subtitle_job_terminates_running_process(self):
        job_id = "c" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "running",
            "stage": "transcribing",
            "progress": 1,
            "message": "",
            "createdAt": 0,
            "updatedAt": 0,
            "segments": [],
            "error": "",
        })

        result = {}

        def run_command():
            try:
                local_service.run_job_command([sys.executable, "-c", "import time; time.sleep(30)"], job_id=job_id)
                result["status"] = "completed"
            except local_service.JobCancelled:
                result["status"] = "cancelled"

        thread = threading.Thread(target=run_command)
        thread.start()
        time.sleep(0.3)
        local_service.cancel_subtitle_job(job_id)
        thread.join(timeout=5)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result.get("status"), "cancelled")
        snapshot = local_service.job_snapshot(job_id)
        self.assertEqual(snapshot["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
