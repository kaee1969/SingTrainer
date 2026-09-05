import type { PitchReading } from "./types";

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

export const A4_FREQUENCY = 440;

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / A4_FREQUENCY);
}

export function midiToFrequency(midiNote: number): number {
  return A4_FREQUENCY * 2 ** ((midiNote - 69) / 12);
}

export function midiToNoteName(midiNote: number): string {
  const roundedMidi = Math.round(midiNote);
  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function frequencyToPitch(
  frequency: number,
  confidence: number,
): PitchReading {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new RangeError("Frequency must be a positive, finite number.");
  }

  const exactMidi = frequencyToMidi(frequency);
  const nearestMidi = Math.round(exactMidi);

  return {
    frequency,
    note: midiToNoteName(nearestMidi),
    cents: Math.round((exactMidi - nearestMidi) * 100),
    confidence,
  };
}

export function centsBetween(
  frequency: number,
  targetFrequency: number,
): number {
  return 1200 * Math.log2(frequency / targetFrequency);
}
