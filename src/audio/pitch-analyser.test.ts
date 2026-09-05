import { describe, expect, it } from "vitest";
import { analysePitchFrame, calculateRms } from "./pitch-analyser";
import { frequencyToPitch } from "./note-utils";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 2048;

function sineWave(frequency: number, amplitude = 0.8): Float32Array {
  return Float32Array.from(
    { length: FRAME_SIZE },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE),
  );
}

describe("analysePitchFrame", () => {
  it("detects a synthetic 440 Hz tone as A4, not an octave away", () => {
    const result = analysePitchFrame(sineWave(440), SAMPLE_RATE);

    expect(result).not.toBeNull();
    expect(result!.frequency).toBeCloseTo(440, 0);
    expect(frequencyToPitch(result!.frequency, result!.confidence).note).toBe(
      "A4",
    );
  });

  it("detects a synthetic 220 Hz tone as A3 without an octave error", () => {
    const result = analysePitchFrame(sineWave(220), SAMPLE_RATE);

    expect(result).not.toBeNull();
    expect(frequencyToPitch(result!.frequency, result!.confidence).note).toBe(
      "A3",
    );
  });

  it("gates silence and signals below the volume floor", () => {
    expect(
      analysePitchFrame(new Float32Array(FRAME_SIZE), SAMPLE_RATE),
    ).toBeNull();
    expect(analysePitchFrame(sineWave(440, 0.001), SAMPLE_RATE)).toBeNull();
  });

  it("calculates frame RMS", () => {
    expect(calculateRms(Float32Array.from([1, -1, 1, -1]))).toBe(1);
  });
});
