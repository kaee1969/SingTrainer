import unittest

from server.lyrics import clean_song_name, fetch_synced_lyrics, parse_synced_lyrics


class LyricsTest(unittest.TestCase):
    def test_cleans_filename_noise(self) -> None:
        self.assertEqual(
            clean_song_name("Singer - My Song (Official Video).mp3"),
            "Singer - My Song",
        )

    def test_parses_lrc_timestamps_and_instrumental_breaks(self) -> None:
        lines = parse_synced_lyrics(
            "[00:01.20] First line\n[00:04.50]\n[00:06.00] Last line",
            10,
        )

        self.assertEqual(
            lines,
            [
                {"startTime": 1.2, "endTime": 4.5, "text": "First line"},
                {"startTime": 4.5, "endTime": 6.0, "text": "♪"},
                {"startTime": 6.0, "endTime": 10, "text": "Last line"},
            ],
        )

    def test_selects_synced_result_nearest_to_song_duration(self) -> None:
        response = [
            {
                "trackName": "Wrong version",
                "artistName": "Singer",
                "duration": 103,
                "syncedLyrics": "[00:01.00] Wrong",
            },
            {
                "trackName": "My Song",
                "artistName": "Singer",
                "duration": 100,
                "syncedLyrics": "[00:01.00] Correct",
            },
        ]

        result = fetch_synced_lyrics(
            "Singer - My Song.mp3",
            100,
            fetch_json=lambda _: response,
        )

        self.assertEqual(result["trackName"], "My Song")
        self.assertEqual(result["lines"][0]["text"], "Correct")


if __name__ == "__main__":
    unittest.main()
