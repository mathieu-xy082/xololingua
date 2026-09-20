"""Language detection samples should cover the whole video."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from xololingua_service import http_api
from xololingua_service.media import language_detection_windows


class LanguageSamplingTests(unittest.TestCase):
    def test_default_uses_ten_evenly_spaced_clips_for_long_videos(self):
        duration = 70 * 60
        windows = language_detection_windows(duration)

        self.assertEqual(len(windows), 10)
        self.assertEqual(windows[0], (0.0, 30.0))
        self.assertEqual(windows[-1], (duration - 30.0, 30.0))
        self.assertEqual(len({start for start, _ in windows}), 10)

    def test_short_video_still_uses_one_clip(self):
        self.assertEqual(language_detection_windows(12), [(0.0, 12)])

    def test_detection_keeps_gpu_runtime_when_available(self):
        gpu = {"backend": "faster-whisper", "device": "cuda", "available": True}
        with TemporaryDirectory() as directory:
            video = Path(directory) / "video.mp4"
            video.touch()
            with (
                mock.patch.object(http_api.whisper_runtime, "WHISPER_RUNTIME", gpu),
                mock.patch.object(http_api, "WORK_DIR", Path(directory)),
                mock.patch.object(http_api, "extract_audio_clips_parallel"),
                mock.patch.object(http_api, "detect_audio_languages", return_value=[
                    {"languageCode": "ru", "languageProbability": 0.9}
                ] * 10) as detect,
            ):
                result = http_api.LocalServiceHandler.detect_language_from_video(None, video, 4200)

        self.assertEqual(detect.call_args.args[1]["device"], "cuda")
        self.assertEqual(len(detect.call_args.args[0]), 10)
        self.assertEqual(result["languageCode"], "ru")


if __name__ == "__main__":
    unittest.main()
