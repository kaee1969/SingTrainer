import { describe, expect, it } from "vitest";
import { centsBetween, frequencyToPitch, midiToFrequency } from "./note-utils";

describe("frequencyToPitch", () => {
  it("converts concert A to A4 at zero cents", () => {
    expect(frequencyToPitch(440, 0.99)).toEqual({
      frequency: 440,
      note: "A4",
      cents: 0,
      confidence: 0.99,
    });
  });

  it("reports cents relative to the nearest note", () => {
    expect(frequencyToPitch(445, 0.95)).toMatchObject({
      note: "A4",
      cents: 20,
    });
  });

  it("rejects invalid frequencies", () => {
    expect(() => frequencyToPitch(0, 1)).toThrow(RangeError);
  });
});

describe("note comparison", () => {
  it("converts MIDI note 69 to 440 Hz", () => {
    expect(midiToFrequency(69)).toBe(440);
  });

  it("measures a full octave as 1200 cents", () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200);
    expect(centsBetween(220, 440)).toBeCloseTo(-1200);
  });
});
