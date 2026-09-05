import math
import unittest

from server.analyzer import segment_pitch_frames


def midi_to_frequency(note: int) -> float:
    return 440 * 2 ** ((note - 69) / 12)


class SegmentPitchFramesTest(unittest.TestCase):
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
