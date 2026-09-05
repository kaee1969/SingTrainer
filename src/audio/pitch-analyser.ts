import { PitchDetector } from "pitchy";

export interface RawPitchFrame {
  frequency: number;
  confidence: number;
  rms: number;
}

export interface PitchGateOptions {
  minConfidence: number;
  minRms: number;
}

export const DEFAULT_PITCH_GATE: PitchGateOptions = {
  minConfidence: 0.86,
  minRms: 0.01,
};

export function calculateRms(frame: Float32Array): number {
  let sumOfSquares = 0;

  for (const sample of frame) {
    sumOfSquares += sample * sample;
  }

  return Math.sqrt(sumOfSquares / frame.length);
}

export function analysePitchFrame(
  frame: Float32Array,
  sampleRate: number,
  gate: PitchGateOptions = DEFAULT_PITCH_GATE,
): RawPitchFrame | null {
  const rms = calculateRms(frame);

  if (rms < gate.minRms) {
    return null;
  }

  const detector = PitchDetector.forFloat32Array(frame.length);
  const [frequency, confidence] = detector.findPitch(frame, sampleRate);

  if (
    confidence < gate.minConfidence ||
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return null;
  }

  return { frequency, confidence, rms };
}
