import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { chooseDefaultTrack, parseMidiFile } from "./midi-parser";

describe("parseMidiFile", () => {
  it("normalizes MIDI tracks into note events", () => {
    const source = new Midi();
    source.name = "Warmup";
    const track = source.addTrack();
    track.name = "Vocal melody";
    track.addNote({ midi: 69, time: 0.5, duration: 1 });

    const bytes = source.toArray();
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = parseMidiFile(data, "fallback.mid");

    expect(result.name).toBe("Warmup");
    expect(result.tracks[0].events).toEqual([
      { startTime: 0.5, endTime: 1.5, midiNote: 69 },
    ]);
  });

  it("rejects MIDI files without notes", () => {
    const source = new Midi();
    const bytes = source.toArray();
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    expect(() => parseMidiFile(data, "empty.mid")).toThrow(
      "does not contain any notes",
    );
  });
});

describe("chooseDefaultTrack", () => {
  it("prefers a named vocal track", () => {
    expect(
      chooseDefaultTrack([
        {
          id: 0,
          name: "Piano",
          instrument: "piano",
          duration: 2,
          events: Array.from({ length: 20 }, (_, index) => ({
            startTime: index,
            endTime: index + 1,
            midiNote: 60,
          })),
        },
        {
          id: 1,
          name: "Lead vocal",
          instrument: "voice oohs",
          duration: 2,
          events: [{ startTime: 0, endTime: 1, midiNote: 69 }],
        },
      ]),
    ).toBe(1);
  });
});
