"""HTTP integration tests for the full pipeline (require ffmpeg/ffprobe)."""

import json
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest import mock

import local_service
from xololingua_service import http_api, jobs, runtime, transcription, translation


class ImmediateFuture:
    def __init__(self):
        self._cancelled = False

    def cancel(self):
        self._cancelled = True
        return False

    def cancelled(self):
        return self._cancelled


class ImmediateExecutor:
    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)
        return ImmediateFuture()


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
class PipelineIntegrationTests(unittest.TestCase):
    """
    Exercises the full HTTP pipeline: extract-audio → segment-audio → subtitle-jobs (poll).
    Whisper and Argos are mocked so the test runs without GPU / language packages.
    """

    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer

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
                with mock.patch.object(http_api, "translation_backend_available", return_value=True):
                    with mock.patch.object(http_api, "JOBS_EXECUTOR", ImmediateExecutor()):
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
            status = self._get_json(f"/api/subtitle-jobs/{job_id}")
            self.assertEqual(status["status"], "succeeded")
            self.assertEqual(status["stage"], "ready")
            self.assertTrue(all("translatedText" in s for s in status["segments"]))
            self.assertEqual(status["segments"][0]["translatedText"], "Hello world.")

    def test_transcribe_audio_retries_cpu_when_cuda_worker_cannot_load(self):
        audio_id = "b" * 32
        segments = [{"index": 1, "start": 0.0, "end": 1.0}]
        transcribed = [{**segments[0], "text": "Bonjour."}]
        cuda_runtime = {"backend": "faster-whisper", "available": True, "device": "cuda", "model": "small", "computeType": "float16"}
        cpu_runtime = {"backend": "faster-whisper", "available": True, "device": "cpu", "model": "base", "computeType": "int8"}
        cuda_error = subprocess.CalledProcessError(
            1, ["worker"], stderr="RuntimeError: CUDA failed with error CUDA-capable device(s) is/are busy or unavailable"
        )

        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"{audio_id}.wav").touch()
            with (
                mock.patch.object(http_api, "WORK_DIR", Path(directory)),
                mock.patch.dict(runtime.WHISPER_RUNTIME, cuda_runtime, clear=True),
                mock.patch.dict(runtime.CPU_WHISPER_RUNTIME, cpu_runtime, clear=True),
                mock.patch.object(transcription, "transcribe_segments", side_effect=[cuda_error, transcribed]) as transcribe,
            ):
                response = self._post_json("/api/transcribe-audio", {
                    "audioId": audio_id,
                    "languageCode": "fr",
                    "segments": segments,
                })

        self.assertEqual(response["segments"], transcribed)
        self.assertEqual([call.kwargs["runtime"]["device"] for call in transcribe.call_args_list], ["cuda", "cpu"])

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

    def test_list_subtitle_jobs_endpoint_returns_jobs(self):
        job_id = "1" * 32
        local_service.put_job(job_id, {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "",
            "createdAt": time.time(),
            "updatedAt": time.time(),
            "segments": [],
            "error": "",
        })

        payload = self._get_json("/api/subtitle-jobs")

        self.assertIn("jobs", payload)
        self.assertTrue(any(job["jobId"] == job_id for job in payload["jobs"]))

    def test_public_mode_hides_other_visitors_jobs(self):
        with mock.patch.object(http_api, "PUBLIC_MODE", True):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self._get_json("/api/subtitle-jobs")
        self.assertEqual(caught.exception.code, 404)
        self.assertIsNone(caught.exception.headers.get("Access-Control-Allow-Origin"))

    def test_public_mode_rejects_processing_when_server_is_busy(self):
        with mock.patch.object(http_api, "PUBLIC_MODE", True):
            self.assertTrue(http_api.PUBLIC_PROCESSING_SLOT.acquire(blocking=False))
            try:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    self._post_json("/api/detect-language", {})
            finally:
                http_api.PUBLIC_PROCESSING_SLOT.release()
        self.assertEqual(caught.exception.code, 429)

    def test_public_audio_response_does_not_expose_server_path(self):
        with tempfile.TemporaryDirectory() as directory:
            mp4_path = Path(directory) / "sample.mp4"
            self._make_test_mp4(mp4_path)
            with mock.patch.object(http_api, "PUBLIC_MODE", True), mock.patch.object(http_api, "public_work_bytes", return_value=0), mock.patch.object(http_api, "allow_public_processing", return_value=True):
                extracted = self._upload_mp4(mp4_path)
            self.assertNotIn("audioPath", extracted)
            self._post_json("/api/release-audio", {"audioId": extracted["audioId"]})

    def test_public_job_queue_has_one_active_slot(self):
        with mock.patch.object(jobs, "JOBS", {}):
            self.assertTrue(jobs.try_put_job("a" * 32, {"status": "queued"}, max_active_jobs=1))
            self.assertFalse(jobs.try_put_job("b" * 32, {"status": "queued"}, max_active_jobs=1))
            jobs.JOBS["a" * 32]["status"] = "succeeded"
            self.assertTrue(jobs.try_put_job("b" * 32, {"status": "queued"}, max_active_jobs=1))

    def test_public_processing_rate_limit_expires_after_one_hour(self):
        with mock.patch.object(http_api, "PUBLIC_REQUEST_TIMES", {}), mock.patch.object(http_api, "PUBLIC_REQUESTS_PER_HOUR", 2):
            self.assertTrue(http_api.allow_public_processing("visitor", now=100))
            self.assertTrue(http_api.allow_public_processing("visitor", now=101))
            self.assertFalse(http_api.allow_public_processing("visitor", now=102))
            self.assertTrue(http_api.allow_public_processing("visitor", now=3701))

    def test_translation_pairs_endpoint_returns_pairs_list(self):
        fake_pairs = [{"source": "ru", "target": "en"}, {"source": "en", "target": "ru"}]
        with mock.patch.object(http_api, "get_supported_pairs", return_value=fake_pairs):
            payload = self._get_json("/api/translation-pairs")

        self.assertIn("pairs", payload)
        self.assertCountEqual(payload["pairs"], fake_pairs)

    def test_release_audio_endpoint_deletes_extracted_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            mp4_path = Path(directory) / "sample.fr.mp4"
            self._make_test_mp4(mp4_path)

            extract = self._upload_mp4(mp4_path)
            audio_id = extract["audioId"]
            audio_path = Path(extract["audioPath"])
            self.assertTrue(audio_path.exists())

            released = self._post_json("/api/release-audio", {"audioId": audio_id})

            self.assertEqual(released["audioId"], audio_id)
            self.assertTrue(released["deleted"])
            self.assertFalse(audio_path.exists())


if __name__ == "__main__":
    unittest.main()
