import math
import sys
import unittest
from pathlib import Path

from server.analyzer import (
    DEMUCS_MODEL,
    _demucs_command,
    filter_note_event_anomalies,
    filter_pitch_anomalies,
    segment_pitch_frames,
    select_higher_harmony_frequency,
    song_display_name,
)


def midi_to_frequency(note: int) -> float:
    return 440 * 2 ** ((note - 69) / 12)


class SegmentPitchFramesTest(unittest.TestCase):
    def test_preserves_dots_inside_an_existing_song_name(self) -> None:
        name = "Singer feat. Guest - Song (Official Video)"

        self.assertEqual(song_display_name(name), name)
        self.assertEqual(song_display_name(f"{name}.mp3"), name)

    def test_corrects_isolated_octave_note_events(self) -> None:
        events = [
            {"startTime": 0.0, "endTime": 1.0, "midiNote": 60},
            {"startTime": 1.1, "endTime": 1.3, "midiNote": 72},
            {"startTime": 1.4, "endTime": 2.4, "midiNote": 60},
        ]

        filtered = filter_note_event_anomalies(events)

        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["midiNote"], 60)
        self.assertEqual(filtered[0]["endTime"], 2.4)

    def test_removes_extreme_events_outside_the_learned_register(self) -> None:
        events = [
            {"startTime": 0.0, "endTime": 1.0, "midiNote": 60},
            {"startTime": 1.1, "endTime": 1.3, "midiNote": 36},
            {"startTime": 1.4, "endTime": 2.4, "midiNote": 61},
        ]

        filtered = filter_note_event_anomalies(events)

        self.assertEqual([event["midiNote"] for event in filtered], [60, 61])

    def test_keeps_sustained_upper_register_notes(self) -> None:
        events = [
            {"startTime": 0.0, "endTime": 2.0, "midiNote": 60},
            {"startTime": 2.1, "endTime": 4.1, "midiNote": 72},
            {"startTime": 4.2, "endTime": 6.2, "midiNote": 60},
        ]

        filtered = filter_note_event_anomalies(events)

        self.assertEqual([event["midiNote"] for event in filtered], [60, 72, 60])

    def test_corrects_brief_octave_errors(self) -> None:
        frequencies = [midi_to_frequency(60)] * 9
        frequencies[4] = midi_to_frequency(72)

        filtered = filter_pitch_anomalies(frequencies, window_radius=4)

        self.assertAlmostEqual(filtered[4], midi_to_frequency(60))

    def test_drops_non_octave_extreme_spikes(self) -> None:
        frequencies = [midi_to_frequency(60)] * 9
        frequencies[4] = midi_to_frequency(80)

        filtered = filter_pitch_anomalies(frequencies, window_radius=4)

        self.assertIsNone(filtered[4])

    def test_keeps_normal_melodic_and_harmony_motion(self) -> None:
        frequencies = [midi_to_frequency(60)] * 5 + [midi_to_frequency(67)] * 5

        filtered = filter_pitch_anomalies(frequencies, window_radius=4)

        self.assertTrue(all(frequency is not None for frequency in filtered))

    def test_selects_higher_harmony_without_accepting_an_octave(self) -> None:
        self.assertAlmostEqual(
            select_higher_harmony_frequency(220, [220, 277.18]),
            277.18,
        )
        self.assertEqual(
            select_higher_harmony_frequency(220, [220, 440]),
            220,
        )

    def test_uses_fine_tuned_vocal_separation(self) -> None:
        command = _demucs_command(Path("song.mp3"), Path("stems"))

        self.assertEqual(command[:3], [sys.executable, "-m", "demucs"])
        self.assertIn(DEMUCS_MODEL, command)
        self.assertEqual(command[command.index("--overlap") + 1], "0.5")
        self.assertEqual(command[command.index("--two-stems") + 1], "vocals")

    def test_groups_stable_frames_into_note_events(self) -> None:
        times = [index * 0.05 for index in range(10)]
        frequencies = [midi_to_frequency(69)] * 5 + [midi_to_frequency(71)] * 5
        events = segment_pitch_frames(
            times,
            frequencies,
            [0.99] * 10,
            frame_duration=0.05,
        )

        self.assertEqual(
            events,
            [
                {"startTime": 0.0, "endTime": 0.25, "midiNote": 69},
                {"startTime": 0.25, "endTime": 0.5, "midiNote": 71},
            ],
        )

    def test_bridges_a_brief_unvoiced_gap(self) -> None:
        times = [index * 0.05 for index in range(7)]
        frequencies = [midi_to_frequency(60)] * 3 + [None] + [midi_to_frequency(60)] * 3
        events = segment_pitch_frames(
            times,
            frequencies,
            [0.99, 0.99, 0.99, 0, 0.99, 0.99, 0.99],
            frame_duration=0.05,
        )

        self.assertEqual(
            events,
            [{"startTime": 0.0, "endTime": 0.35, "midiNote": 60}],
        )

    def test_keeps_short_sung_notes(self) -> None:
        times = [index * 0.03 for index in range(6)]
        events = segment_pitch_frames(
            times,
            [midi_to_frequency(62)] * 3 + [midi_to_frequency(64)] * 3,
            [0.99] * 6,
            frame_duration=0.03,
        )

        self.assertEqual(
            events,
            [
                {"startTime": 0.0, "endTime": 0.09, "midiNote": 62},
                {"startTime": 0.09, "endTime": 0.18, "midiNote": 64},
            ],
        )

    def test_filters_low_confidence_and_tiny_fragments(self) -> None:
        events = segment_pitch_frames(
            [0, 0.05, 0.1],
            [midi_to_frequency(64)] * 3,
            [0.2, 0.2, 0.99],
            frame_duration=0.05,
        )

        self.assertEqual(events, [])

    def test_rejects_mismatched_frame_arrays(self) -> None:
        with self.assertRaises(ValueError):
            segment_pitch_frames([0], [math.nan], [], frame_duration=0.01)


if __name__ == "__main__":
    unittest.main()
