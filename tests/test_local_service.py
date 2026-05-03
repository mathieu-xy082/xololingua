import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import local_service


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

            with mock.patch.object(local_service, "slice_audio") as slice_audio:
                with mock.patch.object(local_service, "transcribe_audio_file", return_value="Bonjour."):
                    result = local_service.transcribe_segments(audio_path, segments, "fr")

            slice_audio.assert_called_once()
            self.assertEqual(result, [{"index": 1, "start": 0.0, "end": 1.5, "text": "Bonjour."}])


if __name__ == "__main__":
    unittest.main()
