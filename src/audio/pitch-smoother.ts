export class MedianPitchSmoother {
  private readonly frequencies: number[] = [];

  constructor(private readonly windowSize = 5) {
    if (windowSize < 1 || windowSize % 2 === 0) {
      throw new RangeError("Window size must be a positive odd number.");
    }
  }

  add(frequency: number): number {
    this.frequencies.push(frequency);

    if (this.frequencies.length > this.windowSize) {
      this.frequencies.shift();
    }

    const sorted = [...this.frequencies].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  clear(): void {
    this.frequencies.length = 0;
  }
}
