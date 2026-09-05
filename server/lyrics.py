from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
USER_AGENT = "SingTrainer/0.3 (personal local singing trainer)"
TIMESTAMP_PATTERN = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")
NOISE_PATTERN = re.compile(
    r"\s*[\[(](?:official|lyrics?|audio|video|visuali[sz]er|hd|4k).*?[\])]",
    re.IGNORECASE,
)


class LyricsNotFoundError(RuntimeError):
    pass


def clean_song_name(name: str) -> str:
    cleaned = Path(name).stem.replace("_", " ").strip()
    cleaned = NOISE_PATTERN.sub("", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip(" -")


def parse_synced_lyrics(synced_lyrics: str, duration: float) -> list[dict[str, object]]:
    timed_lines: list[tuple[float, str]] = []
    for raw_line in synced_lyrics.splitlines():
        timestamps = TIMESTAMP_PATTERN.findall(raw_line)
        if not timestamps:
            continue
        text = TIMESTAMP_PATTERN.sub("", raw_line).strip() or "♪"
        for minutes, seconds in timestamps:
            timed_lines.append((int(minutes) * 60 + float(seconds), text))

    timed_lines.sort(key=lambda line: line[0])
    lines: list[dict[str, object]] = []
    for index, (start_time, text) in enumerate(timed_lines):
        if start_time > duration + 2:
            continue
        next_start = (
            timed_lines[index + 1][0]
            if index + 1 < len(timed_lines)
            else duration
        )
        lines.append(
            {
                "startTime": round(start_time, 3),
                "endTime": round(max(start_time, min(next_start, duration)), 3),
                "text": text,
            }
        )
    return lines


def _fetch_json(url: str) -> object:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urlopen(request, timeout=12) as response:
        return json.load(response)


def fetch_synced_lyrics(
    song_name: str,
    duration: float,
    *,
    fetch_json: Callable[[str], object] = _fetch_json,
) -> dict[str, object]:
    cleaned_name = clean_song_name(song_name)
    url = f"{LRCLIB_SEARCH_URL}?{urlencode({'q': cleaned_name})}"
    response = fetch_json(url)
    if not isinstance(response, list):
        raise LyricsNotFoundError("The lyrics service returned an invalid response")

    candidates = [
        record
        for record in response
        if isinstance(record, dict)
        and isinstance(record.get("syncedLyrics"), str)
        and record["syncedLyrics"].strip()
        and isinstance(record.get("duration"), (int, float))
        and abs(float(record["duration"]) - duration) <= 5
    ]
    if not candidates:
        raise LyricsNotFoundError("No time-synced lyrics were found for this song")

    match = min(
        candidates,
        key=lambda record: abs(float(record["duration"]) - duration),
    )
    lines = parse_synced_lyrics(str(match["syncedLyrics"]), duration)
    if not lines:
        raise LyricsNotFoundError("No time-synced lyrics were found for this song")

    return {
        "trackName": str(match.get("trackName") or match.get("name") or cleaned_name),
        "artistName": str(match.get("artistName") or ""),
        "source": "LRCLIB",
        "lines": lines,
    }
