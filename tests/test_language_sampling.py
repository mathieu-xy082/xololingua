"""Language detection samples should cover the whole video."""

import unittest

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


if __name__ == "__main__":
    unittest.main()
