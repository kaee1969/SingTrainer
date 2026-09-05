import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "../audio/types";

export interface MelodyTrack {
  id: number;
  name: string;
  instrument: string;
  events: NoteEvent[];
  duration: number;
}

export interface ParsedMidi {
  name: string;
  tracks: MelodyTrack[];
  suggestedTrackId: number;
}

const MELODY_WORDS = ["vocal", "voice", "melody", "lead", "sing"];

function trackScore(track: MelodyTrack): number {
  const searchableName = `${track.name} ${track.instrument}`.toLowerCase();
  const nameBonus = MELODY_WORDS.some((word) => searchableName.includes(word))
    ? 10_000
    : 0;
  return nameBonus + track.events.length;
}

export function chooseDefaultTrack(tracks: MelodyTrack[]): number {
  if (tracks.length === 0) return -1;

  return tracks.reduce((best, track) =>
    trackScore(track) > trackScore(best) ? track : best,
  ).id;
}

export function parseMidiFile(data: ArrayBuffer, fileName: string): ParsedMidi {
  const midi = new Midi(data);
  const tracks = midi.tracks
    .map((track, index): MelodyTrack => {
      const events = track.notes
        .map((note) => ({
          startTime: note.time,
          endTime: note.time + note.duration,
          midiNote: note.midi,
        }))
        .filter((event) => event.endTime > event.startTime)
        .sort((a, b) => a.startTime - b.startTime);

      return {
        id: index,
        name: track.name.trim() || `Track ${index + 1}`,
        instrument: track.instrument.name,
        duration: events.at(-1)?.endTime ?? 0,
        events,
      };
    })
    .filter((track) => track.events.length > 0);

  if (tracks.length === 0) {
    throw new Error("This MIDI file does not contain any notes.");
  }

  return {
    name: midi.name.trim() || fileName.replace(/\.(mid|midi)$/i, ""),
    tracks,
    suggestedTrackId: chooseDefaultTrack(tracks),
  };
}
