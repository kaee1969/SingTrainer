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
            "originalMediaType": "audio/mpeg",
        }
        (self.cache_directory / f"{cache_key}.json").write_text(
            json.dumps(result),
            encoding="utf-8",
        )
        (self.cache_directory / f"{cache_key}-vocals.wav").write_bytes(b"wav")
        (self.cache_directory / f"{cache_key}-original.audio").write_bytes(b"mp3")

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
        self.assertEqual(song.json()["originalUrl"], f"/api/original/{cache_key}")

        original = self.client.get(f"/api/original/{cache_key}")
        self.assertEqual(original.status_code, 200)
        self.assertEqual(original.headers["content-type"], "audio/mpeg")

    def test_hides_outdated_analysis(self) -> None:
        self.save_song("b" * 64, current=False)

        response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"songs": []})

    def test_deletes_saved_song_and_its_audio_files(self) -> None:
        cache_key = "d" * 64
        self.save_song(cache_key)

        response = self.client.delete(f"/api/songs/{cache_key}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True})
        self.assertFalse((self.cache_directory / f"{cache_key}.json").exists())
        self.assertFalse(
            (self.cache_directory / f"{cache_key}-vocals.wav").exists()
        )
        self.assertFalse(
            (self.cache_directory / f"{cache_key}-original.audio").exists()
        )
        self.assertEqual(self.client.get("/api/songs").json(), {"songs": []})

    def test_delete_rejects_unknown_or_invalid_song(self) -> None:
        self.assertEqual(self.client.delete("/api/songs/not-a-key").status_code, 400)
        self.assertEqual(
            self.client.delete(f"/api/songs/{'e' * 64}").status_code,
            404,
        )

    def test_fetches_and_caches_synced_lyrics(self) -> None:
        cache_key = "c" * 64
        self.save_song(cache_key)
        lyrics = {
            "trackName": "Warmup",
            "artistName": "Singer",
            "source": "LRCLIB",
            "lines": [{"startTime": 1, "endTime": 2, "text": "Sing"}],
        }

        with patch.object(app_module, "fetch_synced_lyrics", return_value=lyrics) as fetch:
            first = self.client.get(f"/api/lyrics/{cache_key}")
            second = self.client.get(f"/api/lyrics/{cache_key}")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), lyrics)
        fetch.assert_called_once_with("Warmup", 90.0)


if __name__ == "__main__":
    unittest.main()
