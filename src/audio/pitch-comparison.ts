import { centsBetween, midiToFrequency } from "./note-utils";
import type { NoteEvent, PitchReading } from "./types";

export const SCORE_TOLERANCE_CENTS = 50;

export interface ScoreSummary {
  accuracy: number;
  coverage: number;
  averageError: number;
  scoredFrames: number;
}

export function findActiveNote(
  events: NoteEvent[],
  time: number,
): NoteEvent | null {
  let low = 0;
  let high = events.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].startTime <= time) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  for (let index = candidate; index >= 0; index -= 1) {
    const event = events[index];
    if (event.endTime > time) return event;

    if (time - event.startTime > 10) break;
  }

  return null;
}

export function deviationFromMidi(
  reading: PitchReading,
  midiNote: number,
): number {
  return centsBetween(reading.frequency, midiToFrequency(midiNote));
}

export class MelodyScorer {
  private targetFrames = 0;
  private voicedFrames = 0;
  private inTuneFrames = 0;
  private totalAbsoluteError = 0;

  addFrame(target: NoteEvent | null, reading: PitchReading | null): void {
    if (!target) return;

    this.targetFrames += 1;
    if (!reading) return;

    const error = Math.abs(deviationFromMidi(reading, target.midiNote));
    this.voicedFrames += 1;
    this.totalAbsoluteError += error;

    if (error <= SCORE_TOLERANCE_CENTS) {
      this.inTuneFrames += 1;
    }
  }

  summary(): ScoreSummary {
    return {
      accuracy:
        this.voicedFrames === 0
          ? 0
          : Math.round((this.inTuneFrames / this.voicedFrames) * 100),
      coverage:
        this.targetFrames === 0
          ? 0
          : Math.round((this.voicedFrames / this.targetFrames) * 100),
      averageError:
        this.voicedFrames === 0
          ? 0
          : Math.round(this.totalAbsoluteError / this.voicedFrames),
      scoredFrames: this.voicedFrames,
    };
  }
}
