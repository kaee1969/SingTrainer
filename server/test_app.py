import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import server.app as app_module
from server.analyzer import ANALYSIS_VERSION, SEPARATION_VERSION


class SavedSongLibraryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.cache_directory = Path(self.temporary.name)
        self.cache_patch = patch.object(
            app_module,
            "CACHE_DIRECTORY",
            self.cache_directory,
        )
        self.cache_patch.start()
        self.client = TestClient(app_module.app)

    def tearDown(self) -> None:
        self.cache_patch.stop()
        self.temporary.cleanup()

    def save_song(self, cache_key: str, *, current: bool = True) -> None:
        result = {
            "name": "Warmup",
            "duration": 90,
            "events": [{"startTime": 0, "endTime": 1, "midiNote": 69}],
            "analyzer": "test",
            "analysisVersion": ANALYSIS_VERSION if current else 0,
            "separationVersion": SEPARATION_VERSION if current else 0,
        }
        (self.cache_directory / f"{cache_key}.json").write_text(
            json.dumps(result),
            encoding="utf-8",
        )
        (self.cache_directory / f"{cache_key}-vocals.wav").write_bytes(b"wav")

    def test_lists_and_loads_current_saved_songs(self) -> None:
        cache_key = "a" * 64
        self.save_song(cache_key)

        library = self.client.get("/api/songs")
        self.assertEqual(library.status_code, 200)
        self.assertEqual(library.json()["songs"][0]["cacheKey"], cache_key)
        self.assertEqual(library.json()["songs"][0]["eventCount"], 1)

        song = self.client.get(f"/api/songs/{cache_key}")
        self.assertEqual(song.status_code, 200)
        self.assertTrue(song.json()["cached"])
        self.assertEqual(song.json()["vocalUrl"], f"/api/vocals/{cache_key}")

    def test_hides_outdated_analysis(self) -> None:
        self.save_song("b" * 64, current=False)

        response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"songs": []})


if __name__ == "__main__":
    unittest.main()
