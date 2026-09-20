"""Language identification should use the model's dedicated detection API."""

import sys
import unittest
from pathlib import Path
from unittest import mock

import transcribe_worker


class FakeWhisperModel:
    detected_audio = []

    def __init__(self, *_args, **_kwargs):
        pass

    def detect_language(self, *, audio):
        self.detected_audio.append(audio)
        return "ru", 0.9, [("ru", 0.9)]

    def transcribe(self, *_args, **_kwargs):
        raise AssertionError("Language identification must not generate transcript segments")


class WorkerLanguageDetectionTests(unittest.TestCase):
    def setUp(self):
        FakeWhisperModel.detected_audio = []
        self.model_patch = mock.patch.dict(sys.modules, {
            "faster_whisper": mock.Mock(WhisperModel=FakeWhisperModel, decode_audio=lambda path: path),
        })
        self.model_patch.start()
        self.addCleanup(self.model_patch.stop)
        self.runtime = {"model": "small", "device": "cpu", "computeType": "int8"}

    def test_batch_detection_uses_only_language_metadata(self):
        result = transcribe_worker._detect_languages([Path("first.wav"), Path("second.wav")], self.runtime)

        self.assertEqual([item["languageCode"] for item in result], ["ru", "ru"])
        self.assertEqual(FakeWhisperModel.detected_audio, ["first.wav", "second.wav"])

    def test_single_clip_detection_uses_only_language_metadata(self):
        with mock.patch.object(transcribe_worker, "_slice_audio"):
            result = transcribe_worker._detect_language(Path("input.wav"), self.runtime)

        self.assertEqual(result["languageCode"], "ru")
        self.assertEqual(len(FakeWhisperModel.detected_audio), 1)


if __name__ == "__main__":
    unittest.main()
