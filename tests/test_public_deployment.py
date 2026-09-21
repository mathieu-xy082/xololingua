"""Resource limits for the hosted service."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from xololingua_service import http_api


class PublicStorageTests(unittest.TestCase):
    def test_expired_media_is_removed_without_touching_active_job_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            abandoned = work_dir / ("a" * 32 + ".wav")
            active = work_dir / ("b" * 32 + ".wav")
            unrelated = work_dir / "readme.txt"
            for path in (abandoned, active, unrelated):
                path.write_bytes(b"1234")
                os.utime(path, (100, 100))

            jobs = [{"status": "running", "audioId": "b" * 32}]
            with mock.patch.object(http_api, "WORK_DIR", work_dir), mock.patch.object(http_api, "list_job_snapshots", return_value=jobs):
                total = http_api.public_work_bytes(now=100 + 86401)

            self.assertFalse(abandoned.exists())
            self.assertTrue(active.exists())
            self.assertTrue(unrelated.exists())
            self.assertEqual(total, 8)


if __name__ == "__main__":
    unittest.main()
