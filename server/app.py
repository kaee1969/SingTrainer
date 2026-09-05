from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from server.analyzer import ANALYSIS_VERSION, analyse_song, write_cache

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIRECTORY = PROJECT_ROOT / "server" / "cache"
MAX_UPLOAD_BYTES = 1_000_000_000
CHUNK_SIZE = 1024 * 1024

app = FastAPI(title="SingTrainer local analysis service", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/vocals/{cache_key}")
def vocals(cache_key: str) -> FileResponse:
    if len(cache_key) != 64 or any(character not in "0123456789abcdef" for character in cache_key):
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
        vocal_url = f"/api/vocals/{cache_key}"
        if cache_path.exists() and vocal_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("analysisVersion") == ANALYSIS_VERSION:
                return {
                    **cached,
                    "cacheKey": cache_key,
                    "cached": True,
                    "vocalUrl": vocal_url,
                }

        try:
            result = analyse_song(
                source_path,
                original_name,
                vocal_output=vocal_path,
            )
        except Exception as error:
            raise HTTPException(422, str(error)) from error

        write_cache(cache_path, result)
        return {
            **result,
            "cacheKey": cache_key,
            "cached": False,
            "vocalUrl": vocal_url,
        }
