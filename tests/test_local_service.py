import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

import local_service
from xololingua_service import runtime, transcription, translation


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
class LocalServiceAudioTests(unittest.TestCase):
    def test_extract_audio_creates_mono_16khz_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            video_path = directory_path / "sample.en.mp4"
            audio_path = directory_path / "sample.wav"

            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=size=320x180:rate=15",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=44100",
                    "-t",
                    "1",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    str(video_path),
                ],
                check=True,
            )

            duration = local_service.probe_duration(video_path)
            local_service.extract_audio(video_path, audio_path)

            self.assertGreater(duration, 0)
            self.assertTrue(audio_path.exists())
            self.assertGreater(audio_path.stat().st_size, 0)

            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=codec_name,sample_rate,channels",
                    "-of",
                    "json",
                    str(audio_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertIn('"codec_name": "pcm_s16le"', probe.stdout)
            self.assertIn('"sample_rate": "16000"', probe.stdout)
            self.assertIn('"channels": 1', probe.stdout)

    def test_segment_audio_detects_speech_around_silence(self):
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "speech_with_silence.wav"

            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=1",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=channel_layout=mono:sample_rate=16000",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=660:duration=1",
                    "-filter_complex",
                    "[1:a]atrim=duration=1[silence];[0:a][silence][2:a]concat=n=3:v=0:a=1[out]",
                    "-map",
                    "[out]",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(audio_path),
                ],
                check=True,
            )

            duration = local_service.probe_duration(audio_path)
            segments = local_service.segment_audio(audio_path, duration)

            self.assertEqual(len(segments), 2)
            self.assertLess(segments[0]["start"], 0.1)
            self.assertLess(segments[0]["end"], 1.2)
            self.assertGreater(segments[1]["start"], 1.7)
            self.assertGreater(segments[1]["end"], 2.8)

    def test_normalize_segments_rejects_empty_payload(self):
        with self.assertRaisesRegex(ValueError, "At least one segment"):
            local_service.normalize_segments([])

    def test_normalize_segments_rejects_invalid_time_range(self):
        with self.assertRaisesRegex(ValueError, "Segment end"):
            local_service.normalize_segments([{"index": 1, "start": 2, "end": 1}])

    def test_transcribe_segments_preserves_timings_and_adds_text(self):
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "sample.wav"
            audio_path.write_bytes(b"fake wav")
            segments = [{"index": 1, "start": 0.0, "end": 1.5}]

            # Force CLI fallback so transcribe_audio_file is the code path under test
            with mock.patch.dict(runtime.WHISPER_RUNTIME, {"backend": "whisper-cli", "available": False}):
                with mock.patch.object(transcription, "slice_audio") as slice_audio:
                    with mock.patch.object(transcription, "transcribe_audio_file", return_value="Bonjour."):
                        result = local_service.transcribe_segments(audio_path, segments, "fr")

            slice_audio.assert_called_once()
            self.assertEqual(result, [{"index": 1, "start": 0.0, "end": 1.5, "text": "Bonjour."}])

    def test_normalize_text_segments_preserves_text(self):
        result = local_service.normalize_text_segments([
            {"index": 1, "start": 0, "end": 2, "text": " Bonjour. "}
        ])

        self.assertEqual(result, [{"index": 1, "start": 0.0, "end": 2.0, "text": "Bonjour."}])

    def test_translate_segments_adds_translated_text(self):
        segments = [{"index": 1, "start": 0.0, "end": 2.0, "text": "Bonjour."}]

        with mock.patch.object(translation, "translate_text", return_value="Hello."):
            result = local_service.translate_segments(segments, "fr", "en")

        self.assertEqual(result, [{
            "index": 1,
            "start": 0.0,
            "end": 2.0,
            "text": "Bonjour.",
            "translatedText": "Hello.",
        }])

    def test_translate_segments_preserves_order_with_workers(self):
        segments = [
            {"index": 1, "start": 0.0, "end": 1.0, "text": "Un."},
            {"index": 2, "start": 1.0, "end": 2.0, "text": "Deux."},
        ]

        def fake_translate(text, _source, _target):
            return {"Un.": "One.", "Deux.": "Two."}[text]

        with mock.patch.object(translation, "translate_text", side_effect=fake_translate):
            result = local_service.translate_segments(segments, "fr", "en", max_workers=2)

        self.assertEqual([segment["translatedText"] for segment in result], ["One.", "Two."])

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


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
class PipelineIntegrationTests(unittest.TestCase):
    """
    Exercises the full HTTP pipeline: extract-audio → segment-audio → subtitle-jobs (poll).
    Whisper and Argos are mocked so the test runs without GPU / language packages.
    """

    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        import threading

        cls._server = ThreadingHTTPServer(("127.0.0.1", 0), local_service.LocalServiceHandler)
        cls._port = cls._server.server_address[1]
        cls._thread = threading.Thread(target=cls._server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()

    def _url(self, path):
        return f"http://127.0.0.1:{self._port}{path}"

    def _make_test_mp4(self, path):
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                "-t", "3",
                "-pix_fmt", "yuv420p",
                "-c:v", "libx264",
                "-c:a", "aac",
                str(path),
            ],
            check=True,
        )

    def _post_json(self, path, payload):
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            self._url(path),
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def _get_json(self, path):
        with urllib.request.urlopen(self._url(path)) as r:
            return json.loads(r.read())

    def _upload_mp4(self, mp4_path):
        boundary = "XOLO_TEST_BOUNDARY"
        with open(mp4_path, "rb") as f:
            data = f.read()
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="video"; filename="{mp4_path.name}"\r\n'
            f"Content-Type: video/mp4\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            self._url("/api/extract-audio"),
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_full_pipeline_extract_segment_subtitle(self):
        with tempfile.TemporaryDirectory() as directory:
            mp4_path = Path(directory) / "sample.fr.mp4"
            self._make_test_mp4(mp4_path)

            # --- extract-audio ---
            extract = self._upload_mp4(mp4_path)
            self.assertIn("audioId", extract)
            self.assertGreater(extract["durationSeconds"], 0)
            audio_id = extract["audioId"]

            # --- segment-audio ---
            seg = self._post_json("/api/segment-audio", {"audioId": audio_id})
            self.assertIn("segments", seg)
            self.assertGreater(len(seg["segments"]), 0)
            segments = seg["segments"]

            # --- subtitle-jobs (with mocked Whisper + Argos) ---
            transcribed = [dict(s, text="Bonjour le monde.") for s in segments]
            translated = [dict(s, translatedText="Hello world.") for s in transcribed]

            runtime_available = {"backend": "faster-whisper", "available": True, "device": "cpu", "model": "base", "computeType": "int8", "cudaDevices": 0}
            with mock.patch.dict(runtime.WHISPER_RUNTIME, runtime_available):
                with mock.patch.object(transcription, "transcribe_segments", return_value=transcribed):
                    with mock.patch.object(translation, "translate_segments", return_value=translated):
                        job = self._post_json("/api/subtitle-jobs", {
                            "audioId": audio_id,
                            "sourceLanguage": "fr",
                            "targetLanguage": "en",
                            "segments": segments,
                        })

            self.assertIn("jobId", job)
            job_id = job["jobId"]

            # --- poll until done (max 30 s) ---
            deadline = time.time() + 30
            while time.time() < deadline:
                time.sleep(0.5)
                status = self._get_json(f"/api/subtitle-jobs/{job_id}")
                if status["status"] in ("succeeded", "failed"):
                    break

            self.assertEqual(status["status"], "succeeded")
            self.assertEqual(status["stage"], "ready")
            self.assertTrue(all("translatedText" in s for s in status["segments"]))
            self.assertEqual(status["segments"][0]["translatedText"], "Hello world.")

    def test_cancel_subtitle_job_endpoint_marks_job_cancelled(self):
        job_id = "d" * 32
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

        status = self._post_json(f"/api/subtitle-jobs/{job_id}/cancel", {})

        self.assertEqual(status["status"], "cancelled")
        self.assertEqual(status["stage"], "cancelled")


if __name__ == "__main__":
    unittest.main()
