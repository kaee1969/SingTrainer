import * as Tone from "tone";
import { midiToFrequency } from "./note-utils";
import type { NoteEvent } from "./types";

export class MelodyPlayer {
  private synth: Tone.PolySynth | null = null;
  private part: Tone.Part<[number, NoteEvent]> | null = null;

  get currentTime(): number {
    return Tone.getTransport().seconds;
  }

  async prepare(): Promise<void> {
    await Tone.start();
  }

  async play(events: NoteEvent[]): Promise<void> {
    await this.prepare();
    this.stop();

    this.synth = new Tone.PolySynth(Tone.Synth, {
      volume: -12,
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.01,
        decay: 0.08,
        sustain: 0.2,
        release: 0.12,
      },
    }).toDestination();

    const scheduledEvents: Array<[number, NoteEvent]> = events.map((event) => [
      event.startTime,
      event,
    ]);

    this.part = new Tone.Part<[number, NoteEvent]>((time, event) => {
      this.synth?.triggerAttackRelease(
        midiToFrequency(event.midiNote),
        Math.max(0.04, event.endTime - event.startTime),
        time,
      );
    }, scheduledEvents);

    this.part.start(0);
    const transport = Tone.getTransport();
    transport.seconds = 0;
    transport.start();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.seconds = 0;

    this.part?.dispose();
    this.part = null;
    this.synth?.releaseAll();
    this.synth?.dispose();
    this.synth = null;
  }

  dispose(): void {
    this.stop();
  }
}
