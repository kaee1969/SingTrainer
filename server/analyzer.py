from __future__ import annotations

import json
import math
import shutil
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence


ANALYSIS_VERSION = 2


def frequency_to_midi(frequency: float) -> float:
    return 69 + 12 * math.log2(frequency / 440)


def segment_pitch_frames(
    times: Sequence[float],
    frequencies: Sequence[Optional[float]],
    confidences: Sequence[float],
    *,
    frame_duration: float,
    minimum_confidence: float = 0.6,
    minimum_note_duration: float = 0.08,
    maximum_gap_duration: float = 0.2,
) -> list[dict[str, float | int]]:
    """Convert a monophonic pitch curve into stable, discrete note events."""
    if not (len(times) == len(frequencies) == len(confidences)):
        raise ValueError("Pitch frame arrays must have the same length")
    if not times:
        return []

    raw_notes: list[Optional[int]] = []
    for frequency, confidence in zip(frequencies, confidences, strict=True):
        if (
            frequency is None
            or not math.isfinite(frequency)
            or frequency <= 0
            or confidence < minimum_confidence
        ):
            raw_notes.append(None)
        else:
            raw_notes.append(round(frequency_to_midi(frequency)))

    smoothed = raw_notes.copy()
    for index, note in enumerate(raw_notes):
        if note is None:
            continue
        neighbours = [
            candidate
            for candidate in raw_notes[max(0, index - 2) : index + 3]
            if candidate is not None
        ]
        smoothed[index] = round(statistics.median(neighbours))

    maximum_gap_frames = max(1, round(maximum_gap_duration / frame_duration))
    index = 0
    while index < len(smoothed):
        if smoothed[index] is not None:
            index += 1
            continue

        gap_start = index
        while index < len(smoothed) and smoothed[index] is None:
            index += 1
        gap_end = index
        previous_note = smoothed[gap_start - 1] if gap_start > 0 else None
        next_note = smoothed[gap_end] if gap_end < len(smoothed) else None

        if (
            gap_end - gap_start <= maximum_gap_frames
            and previous_note is not None
            and previous_note == next_note
        ):
            smoothed[gap_start:gap_end] = [previous_note] * (gap_end - gap_start)

    events: list[dict[str, float | int]] = []
    segment_start = 0
    while segment_start < len(smoothed):
        note = smoothed[segment_start]
        if note is None:
            segment_start += 1
            continue

        segment_end = segment_start + 1
        while segment_end < len(smoothed) and smoothed[segment_end] == note:
            segment_end += 1

        start_time = float(times[segment_start])
        end_time = float(times[segment_end - 1]) + frame_duration
        if end_time - start_time >= minimum_note_duration:
            events.append(
                {
                    "startTime": round(start_time, 4),
                    "endTime": round(end_time, 4),
                    "midiNote": note,
                }
            )
        segment_start = segment_end

    merged: list[dict[str, float | int]] = []
    for event in events:
        if (
            merged
            and merged[-1]["midiNote"] == event["midiNote"]
            and float(event["startTime"]) - float(merged[-1]["endTime"])
            <= maximum_gap_duration
        ):
            merged[-1]["endTime"] = event["endTime"]
        else:
            merged.append(event.copy())

    return merged


def _normalise_audio(source: Path, destination: Path) -> None:
    import imageio_ffmpeg

    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-y",
        "-i",
        str(source),
        "-vn",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(destination),
    ]
    subprocess.run(command, check=True, capture_output=True)


def _separate_vocals(source: Path, output_directory: Path) -> Path:
    command = [
        sys.executable,
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        "htdemucs",
        "-o",
        str(output_directory),
        str(source),
    ]
    subprocess.run(command, check=True)
    vocal_path = output_directory / "htdemucs" / source.stem / "vocals.wav"
    if not vocal_path.exists():
        raise RuntimeError("Demucs completed without producing a vocal stem")
    return vocal_path


def analyse_song(
    source: Path,
    original_name: str,
    *,
    vocal_output: Path | None = None,
) -> dict[str, object]:
    import librosa
    import numpy as np

    work_directory = source.parent / "analysis"
    if vocal_output is not None and vocal_output.exists():
        # Reuse the expensive Demucs result when only the pitch-analysis
        # algorithm has changed.
        vocal_path = vocal_output
    else:
        work_directory.mkdir(parents=True, exist_ok=True)
        normalised_path = work_directory / "source.wav"
        separated_directory = work_directory / "separated"
        _normalise_audio(source, normalised_path)
        vocal_path = _separate_vocals(normalised_path, separated_directory)

    sample_rate = 22_050
    hop_length = 256
    audio, _ = librosa.load(vocal_path, sr=sample_rate, mono=True)
    frequencies, voiced_flags, voiced_probabilities = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sample_rate,
        frame_length=2048,
        hop_length=hop_length,
        # Preserve pYIN's best estimate on every frame. Its voiced flag and
        # the vocal-stem volume floor below decide which estimates are usable.
        fill_na=None,
    )
    times = librosa.times_like(
        frequencies,
        sr=sample_rate,
        hop_length=hop_length,
    )
    frame_duration = hop_length / sample_rate
    rms = librosa.feature.rms(
        y=audio,
        frame_length=2048,
        hop_length=hop_length,
    )[0][: len(frequencies)]
    noise_floor = float(np.percentile(rms, 20))
    volume_floor = max(1e-5, noise_floor * 3, float(np.max(rms)) * 0.001)
    usable_frames = [
        bool(flag) and float(volume) >= volume_floor and np.isfinite(frequency)
        for frequency, flag, volume in zip(
            frequencies,
            voiced_flags,
            rms,
            strict=True,
        )
    ]
    safe_frequencies = [
        float(frequency) if usable else None
        for frequency, usable in zip(frequencies, usable_frames, strict=True)
    ]
    safe_probabilities = [
        0.0 if np.isnan(probability) else float(probability)
        for probability in voiced_probabilities
    ]
    events = segment_pitch_frames(
        [float(time) for time in times],
        safe_frequencies,
        safe_probabilities,
        frame_duration=frame_duration,
        # pYIN's voiced flag is already its voiced/unvoiced confidence gate.
        # Applying another high probability threshold here discarded most
        # quiet or breathy singing.
        minimum_confidence=0,
    )

    if not events:
        raise RuntimeError("No stable vocal melody was detected in this audio file")

    if vocal_output is not None and vocal_path != vocal_output:
        vocal_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(vocal_path, vocal_output)

    return {
        "name": Path(original_name).stem,
        "duration": round(float(librosa.get_duration(y=audio, sr=sample_rate)), 4),
        "events": events,
        "analyzer": "Demucs htdemucs + librosa pYIN",
        "analysisVersion": ANALYSIS_VERSION,
    }


def write_cache(path: Path, result: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
