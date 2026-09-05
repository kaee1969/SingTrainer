import { describe, expect, it } from "vitest";
import { frequencyToPitch } from "./note-utils";
import {
  deviationFromMidi,
  findActiveNote,
  MelodyScorer,
} from "./pitch-comparison";
import type { NoteEvent } from "./types";

const events: NoteEvent[] = [
  { startTime: 0, endTime: 1, midiNote: 69 },
  { startTime: 1.5, endTime: 2.5, midiNote: 71 },
];

describe("findActiveNote", () => {
  it("finds notes and preserves rests", () => {
    expect(findActiveNote(events, 0.5)?.midiNote).toBe(69);
    expect(findActiveNote(events, 1.25)).toBeNull();
    expect(findActiveNote(events, 2)?.midiNote).toBe(71);
  });
});

describe("pitch scoring", () => {
  it("measures cents from the target MIDI note", () => {
    expect(deviationFromMidi(frequencyToPitch(440, 1), 69)).toBeCloseTo(0);
    expect(deviationFromMidi(frequencyToPitch(880, 1), 69)).toBeCloseTo(1200);
  });

  it("reports accuracy separately from coverage", () => {
    const scorer = new MelodyScorer();
    scorer.addFrame(events[0], frequencyToPitch(440, 1));
    scorer.addFrame(events[0], frequencyToPitch(466.16, 1));
    scorer.addFrame(events[0], null);

    expect(scorer.summary()).toMatchObject({
      accuracy: 50,
      coverage: 67,
      scoredFrames: 2,
    });
  });
});
