from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from server.analyzer import (
    ANALYSIS_VERSION,
    SEPARATION_VERSION,
    analyse_song,
    write_cache,
)
from server.lyrics import LyricsNotFoundError, fetch_synced_lyrics

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIRECTORY = PROJECT_ROOT / "server" / "cache"
MAX_UPLOAD_BYTES = 1_000_000_000
CHUNK_SIZE = 1024 * 1024

app = FastAPI(title="SingTrainer local analysis service", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _valid_cache_key(cache_key: str) -> bool:
    return len(cache_key) == 64 and all(
        character in "0123456789abcdef" for character in cache_key
    )


def _read_current_cache(cache_key: str) -> dict[str, object] | None:
    if not _valid_cache_key(cache_key):
        return None

    cache_path = CACHE_DIRECTORY / f"{cache_key}.json"
    vocal_path = CACHE_DIRECTORY / f"{cache_key}-vocals.wav"
    original_path = CACHE_DIRECTORY / f"{cache_key}-original.audio"
    if not cache_path.exists() or not vocal_path.exists() or not original_path.exists():
        return None

    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    if (
        not isinstance(cached, dict)
        or cached.get("analysisVersion") != ANALYSIS_VERSION
        or cached.get("separationVersion") != SEPARATION_VERSION
    ):
        return None
    return cached


@app.get("/api/songs")
def saved_songs() -> dict[str, list[dict[str, object]]]:
    songs: list[dict[str, object]] = []
    for cache_path in CACHE_DIRECTORY.glob("*.json"):
        cache_key = cache_path.stem
        cached = _read_current_cache(cache_key)
        if cached is None:
            continue

        events = cached.get("events")
        if (
            not isinstance(cached.get("name"), str)
            or not isinstance(cached.get("duration"), (int, float))
            or not isinstance(cached.get("analyzer"), str)
            or not isinstance(events, list)
        ):
            continue

        vocal_path = CACHE_DIRECTORY / f"{cache_key}-vocals.wav"
        original_path = CACHE_DIRECTORY / f"{cache_key}-original.audio"
        saved_timestamp = max(
            cache_path.stat().st_mtime,
            vocal_path.stat().st_mtime,
            original_path.stat().st_mtime,
        )
        songs.append(
            {
                "name": cached["name"],
                "duration": cached["duration"],
                "eventCount": len(events),
                "analyzer": cached["analyzer"],
                "cacheKey": cache_key,
                "savedAt": datetime.fromtimestamp(
                    saved_timestamp,
                    tz=timezone.utc,
                ).isoformat(),
            }
        )

    songs.sort(key=lambda song: str(song["savedAt"]), reverse=True)
    return {"songs": songs}


@app.get("/api/songs/{cache_key}")
def saved_song(cache_key: str) -> dict[str, object]:
    if not _valid_cache_key(cache_key):
        raise HTTPException(400, "Invalid cache key")

    cached = _read_current_cache(cache_key)
    if cached is None:
        raise HTTPException(404, "Saved song was not found")

    return {
        **cached,
        "cacheKey": cache_key,
        "cached": True,
        "vocalUrl": f"/api/vocals/{cache_key}",
        "originalUrl": f"/api/original/{cache_key}",
    }


@app.delete("/api/songs/{cache_key}")
def delete_saved_song(cache_key: str) -> dict[str, bool]:
    if not _valid_cache_key(cache_key):
        raise HTTPException(400, "Invalid cache key")

    paths = (
        CACHE_DIRECTORY / f"{cache_key}.json",
        CACHE_DIRECTORY / f"{cache_key}-vocals.wav",
        CACHE_DIRECTORY / f"{cache_key}-original.audio",
    )
    if not any(path.exists() for path in paths):
        raise HTTPException(404, "Saved song was not found")

    for path in paths:
        path.unlink(missing_ok=True)

    return {"deleted": True}


@app.get("/api/original/{cache_key}")
def original_audio(cache_key: str) -> FileResponse:
    if not _valid_cache_key(cache_key):
        raise HTTPException(400, "Invalid cache key")

    cached = _read_current_cache(cache_key)
    original_path = CACHE_DIRECTORY / f"{cache_key}-original.audio"
    if cached is None or not original_path.exists():
        raise HTTPException(404, "Original song audio was not found")

    media_type = cached.get("originalMediaType")
    return FileResponse(
        original_path,
        media_type=media_type if isinstance(media_type, str) else "audio/mpeg",
    )


@app.get("/api/lyrics/{cache_key}")
def lyrics(cache_key: str) -> dict[str, object]:
    if not _valid_cache_key(cache_key):
        raise HTTPException(400, "Invalid cache key")

    cached = _read_current_cache(cache_key)
    if cached is None:
        raise HTTPException(404, "Saved song was not found")

    stored_lyrics = cached.get("lyrics")
    if isinstance(stored_lyrics, dict):
        return stored_lyrics

    try:
        result = fetch_synced_lyrics(
            str(cached["name"]),
            float(cached["duration"]),
        )
    except LyricsNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except Exception as error:
        raise HTTPException(502, "The lyrics service could not be reached") from error

    cached["lyrics"] = result
    write_cache(CACHE_DIRECTORY / f"{cache_key}.json", cached)
    return result


@app.get("/api/vocals/{cache_key}")
def vocals(cache_key: str) -> FileResponse:
    if not _valid_cache_key(cache_key):
        raise HTTPException(400, "Invalid cache key")

    vocal_path = CACHE_DIRECTORY / f"{cache_key}-vocals.wav"
    if not vocal_path.exists():
        raise HTTPException(404, "Extracted vocal audio was not found")

    return FileResponse(vocal_path, media_type="audio/wav", filename="vocals.wav")


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)) -> dict[str, object]:
    original_name = Path(file.filename or "song-audio").name
    suffix = Path(original_name).suffix or ".audio"
    digest = hashlib.sha256()
    total_bytes = 0
    original_media_type = (
        file.content_type
        if file.content_type and file.content_type.startswith("audio/")
        else mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    )

    with tempfile.TemporaryDirectory(prefix="singtrainer-") as temporary:
        source_path = Path(temporary) / f"upload{suffix}"
        with source_path.open("wb") as destination:
            while chunk := await file.read(CHUNK_SIZE):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Audio file exceeds the 1 GB local limit")
                digest.update(chunk)
                destination.write(chunk)

        if total_bytes == 0:
            raise HTTPException(400, "The uploaded audio file is empty")

        cache_key = digest.hexdigest()
        cache_path = CACHE_DIRECTORY / f"{cache_key}.json"
        vocal_path = CACHE_DIRECTORY / f"{cache_key}-vocals.wav"
        original_path = CACHE_DIRECTORY / f"{cache_key}-original.audio"
        vocal_url = f"/api/vocals/{cache_key}"
        original_url = f"/api/original/{cache_key}"
        cached: dict[str, object] | None = None
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if (
                vocal_path.exists()
                and cached.get("analysisVersion") == ANALYSIS_VERSION
                and cached.get("separationVersion") == SEPARATION_VERSION
            ):
                original_path.parent.mkdir(parents=True, exist_ok=True)
                if not original_path.exists():
                    shutil.copyfile(source_path, original_path)
                cached["originalMediaType"] = original_media_type
                write_cache(cache_path, cached)
                return {
                    **cached,
                    "cacheKey": cache_key,
                    "cached": True,
                    "vocalUrl": vocal_url,
                    "originalUrl": original_url,
                }

        try:
            result = analyse_song(
                source_path,
                original_name,
                vocal_output=vocal_path,
                reuse_existing_vocal=(
                    vocal_path.exists()
                    and cached is not None
                    and cached.get("separationVersion") == SEPARATION_VERSION
                ),
            )
        except Exception as error:
            raise HTTPException(422, str(error)) from error

        original_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, original_path)
        result["originalMediaType"] = original_media_type
        write_cache(cache_path, result)
        return {
            **result,
            "cacheKey": cache_key,
            "cached": False,
            "vocalUrl": vocal_url,
            "originalUrl": original_url,
        }
