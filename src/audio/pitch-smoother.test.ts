import { describe, expect, it } from "vitest";
import { MedianPitchSmoother } from "./pitch-smoother";

describe("MedianPitchSmoother", () => {
  it("smooths small frame-to-frame jitter", () => {
    const smoother = new MedianPitchSmoother(5);

    [439, 441, 440, 442].forEach((frequency) => smoother.add(frequency));

    expect(smoother.add(438)).toBe(440);
  });

  it("rejects a single-frame octave error", () => {
    const smoother = new MedianPitchSmoother(5);

    [440, 441, 880, 439].forEach((frequency) => smoother.add(frequency));

    expect(smoother.add(440)).toBe(440);
  });

  it("clears readings after silence", () => {
    const smoother = new MedianPitchSmoother(3);
    smoother.add(440);
    smoother.add(441);
    smoother.clear();

    expect(smoother.add(220)).toBe(220);
  });
});
