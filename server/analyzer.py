from __future__ import annotations

import json
import math
import shutil
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence


ANALYSIS_VERSION = 6
SEPARATION_VERSION = 2
DEMUCS_MODEL = "htdemucs_ft"
DEMUCS_OVERLAP = 0.5
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".webm"}


def frequency_to_midi(frequency: float) -> float:
    return 69 + 12 * math.log2(frequency / 440)


def midi_to_frequency(midi_note: float) -> float:
    return 440 * 2 ** ((midi_note - 69) / 12)


def song_display_name(original_name: str) -> str:
    path = Path(original_name)
    return path.stem if path.suffix.lower() in AUDIO_EXTENSIONS else path.name


def select_higher_harmony_frequency(
    dominant_frequency: float,
    candidates: Sequence[float],
    *,
    minimum_interval: float = 1.5,
    maximum_interval: float = 10.5,
) -> float:
    """Prefer a detected upper voice without accepting octave harmonics."""
    higher_candidates = []
    for candidate in candidates:
        if not math.isfinite(candidate) or candidate <= 0:
            continue
        interval = 12 * math.log2(candidate / dominant_frequency)
        if minimum_interval <= interval <= maximum_interval:
            higher_candidates.append(candidate)

    return max(higher_candidates, default=dominant_frequency)


def filter_pitch_anomalies(
    frequencies: Sequence[Optional[float]],
    *,
    window_radius: int = 10,
    maximum_local_deviation: float = 7,
    octave_correction_tolerance: float = 3,
) -> list[Optional[float]]:
    """Remove brief extreme jumps while retaining sustained melodic changes."""
    midi_values = [
        frequency_to_midi(frequency)
        if frequency is not None and math.isfinite(frequency) and frequency > 0
        else None
        for frequency in frequencies
    ]
    filtered: list[Optional[float]] = list(frequencies)

    for index, midi_value in enumerate(midi_values):
        if midi_value is None:
            filtered[index] = None
            continue

        neighbours = [
            candidate
            for candidate in midi_values[
                max(0, index - window_radius) : index + window_radius + 1
            ]
            if candidate is not None
        ]
        if len(neighbours) < 5:
            continue

        local_median = statistics.median(neighbours)
        if abs(midi_value - local_median) <= maximum_local_deviation:
            continue

        octave_options = [midi_value + shift for shift in (-24, -12, 12, 24)]
        corrected = min(
            octave_options,
            key=lambda candidate: abs(candidate - local_median),
        )
        if abs(corrected - local_median) <= octave_correction_tolerance:
            filtered[index] = midi_to_frequency(corrected)
        else:
            filtered[index] = None

    return filtered


def _weighted_median(values: Sequence[tuple[float, float]]) -> float:
    ordered = sorted(values)
    midpoint = sum(weight for _, weight in ordered) / 2
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= midpoint:
            return value
    return ordered[-1][0]


def filter_note_event_anomalies(
    events: Sequence[dict[str, float | int]],
    *,
    lower_register_span: float = 13,
    upper_register_span: float = 19,
    neighbourhood_seconds: float = 2.5,
    maximum_local_deviation: float = 8,
    maximum_outlier_duration: float = 0.8,
) -> list[dict[str, float | int]]:
    """Correct or remove short events far outside the surrounding voice."""
    if not events:
        return []

    weighted_notes = [
        (
            float(event["midiNote"]),
            max(0.001, float(event["endTime"]) - float(event["startTime"])),
        )
        for event in events
    ]
    register_center = _weighted_median(weighted_notes)
    lower_bound = register_center - lower_register_span
    upper_bound = register_center + upper_register_span
    in_register = [
        event.copy()
        for event in events
        if lower_bound <= float(event["midiNote"]) <= upper_bound
    ]

    filtered: list[dict[str, float | int]] = []
    for event in in_register:
        midpoint = (float(event["startTime"]) + float(event["endTime"])) / 2
        neighbours = [
            candidate
            for candidate in in_register
            if abs(
                (float(candidate["startTime"]) + float(candidate["endTime"])) / 2
                - midpoint
            )
            <= neighbourhood_seconds
        ]
        local_median = _weighted_median(
            [
                (
                    float(candidate["midiNote"]),
                    float(candidate["endTime"]) - float(candidate["startTime"]),
                )
                for candidate in neighbours
            ]
        )
        note = float(event["midiNote"])
        duration = float(event["endTime"]) - float(event["startTime"])
        if (
            abs(note - local_median) > maximum_local_deviation
            and duration <= maximum_outlier_duration
        ):
            octave_options = [note + shift for shift in (-24, -12, 12, 24)]
            corrected = min(
                octave_options,
                key=lambda candidate: abs(candidate - local_median),
            )
            if (
                abs(corrected - local_median) <= 3
                and lower_bound <= corrected <= upper_bound
            ):
                event["midiNote"] = round(corrected)
            else:
                continue

        if (
            filtered
            and filtered[-1]["midiNote"] == event["midiNote"]
            and float(event["startTime"]) - float(filtered[-1]["endTime"]) <= 0.2
        ):
            filtered[-1]["endTime"] = event["endTime"]
        else:
            filtered.append(event)

    return filtered


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


def _demucs_command(source: Path, output_directory: Path) -> list[str]:
    return [
        sys.executable,
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        DEMUCS_MODEL,
        "--overlap",
        str(DEMUCS_OVERLAP),
        "-o",
        str(output_directory),
        str(source),
    ]


def _separate_vocals(source: Path, output_directory: Path) -> Path:
    command = _demucs_command(source, output_directory)
    subprocess.run(command, check=True)
    vocal_path = output_directory / DEMUCS_MODEL / source.stem / "vocals.wav"
    if not vocal_path.exists():
        raise RuntimeError("Demucs completed without producing a vocal stem")
    return vocal_path


def analyse_song(
    source: Path,
    original_name: str,
    *,
    vocal_output: Path | None = None,
    reuse_existing_vocal: bool = False,
) -> dict[str, object]:
    import librosa
    import numpy as np

    work_directory = source.parent / "analysis"
    if (
        reuse_existing_vocal
        and vocal_output is not None
        and vocal_output.exists()
    ):
        # Reuse the expensive Demucs result when only the pitch-analysis
        # algorithm has changed.
        vocal_path = vocal_output
    else:
        work_directory.mkdir(parents=True, exist_ok=True)
        normalised_path = work_directory / "source.wav"
        separated_directory = work_directory / "separated"
        _normalise_audio(source, normalised_path)
        vocal_path = _separate_vocals(normalised_path, separated_directory)

    from essentia.standard import MultiPitchKlapuri

    sample_rate = 44_100
    frame_length = 4096
    hop_length = 512
    audio, _ = librosa.load(vocal_path, sr=sample_rate, mono=True)
    dominant_frequencies, voiced_flags, voiced_probabilities = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sample_rate,
        frame_length=frame_length,
        hop_length=hop_length,
        # Preserve pYIN's best estimate on every frame. Its voiced flag and
        # the vocal-stem volume floor below decide which estimates are usable.
        fill_na=None,
    )
    harmony_candidates = MultiPitchKlapuri(
        sampleRate=sample_rate,
        frameSize=frame_length,
        hopSize=hop_length,
        minFrequency=float(librosa.note_to_hz("C2")),
        maxFrequency=float(librosa.note_to_hz("C6")),
    )(audio.astype(np.float32))
    frame_count = min(len(dominant_frequencies), len(harmony_candidates))
    dominant_frequencies = dominant_frequencies[:frame_count]
    voiced_flags = voiced_flags[:frame_count]
    voiced_probabilities = voiced_probabilities[:frame_count]
    frequencies = [
        select_higher_harmony_frequency(float(dominant), candidates)
        for dominant, candidates in zip(
            dominant_frequencies,
            harmony_candidates[:frame_count],
            strict=True,
        )
    ]
    rms = librosa.feature.rms(
        y=audio,
        frame_length=frame_length,
        hop_length=hop_length,
    )[0][:frame_count]
    frame_count = min(frame_count, len(rms))
    frequencies = frequencies[:frame_count]
    voiced_flags = voiced_flags[:frame_count]
    voiced_probabilities = voiced_probabilities[:frame_count]
    rms = rms[:frame_count]
    times = np.arange(frame_count, dtype=float) * hop_length / sample_rate
    frame_duration = hop_length / sample_rate
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
    safe_frequencies = filter_pitch_anomalies(safe_frequencies)
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
    events = filter_note_event_anomalies(events)

    if not events:
        raise RuntimeError("No stable vocal melody was detected in this audio file")

    if vocal_output is not None and vocal_path != vocal_output:
        vocal_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(vocal_path, vocal_output)

    return {
        "name": song_display_name(original_name),
        "duration": round(float(librosa.get_duration(y=audio, sr=sample_rate)), 4),
        "events": events,
        "analyzer": (
            f"Demucs {DEMUCS_MODEL} + anomaly-filtered pYIN/Essentia harmony tracking"
        ),
        "analysisVersion": ANALYSIS_VERSION,
        "separationVersion": SEPARATION_VERSION,
    }


def write_cache(path: Path, result: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
