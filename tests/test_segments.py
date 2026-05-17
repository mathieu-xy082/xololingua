"""Unit tests for segment normalization and transcription (no ffmpeg required)."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import local_service
from xololingua_service import runtime, transcription


class SegmentNormalizationTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
