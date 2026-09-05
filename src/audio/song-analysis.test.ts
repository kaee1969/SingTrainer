import { describe, expect, it } from "vitest";
import { parseAnalyzedSong, parseSavedSongs } from "./song-analysis";

describe("parseAnalyzedSong", () => {
  it("accepts normalized analysis results", () => {
    const result = parseAnalyzedSong({
      name: "Warmup",
      duration: 4,
      events: [{ startTime: 0, endTime: 1, midiNote: 69 }],
      analyzer: "test",
      cacheKey: "abc",
      cached: false,
      vocalUrl: "/api/vocals/abc",
      originalUrl: "/api/original/abc",
    });

    expect(result.events[0].midiNote).toBe(69);
  });

  it("rejects malformed note events", () => {
    expect(() =>
      parseAnalyzedSong({
        name: "Broken",
        duration: 4,
        events: [{ startTime: 1, endTime: 0, midiNote: 69 }],
        analyzer: "test",
        cacheKey: "abc",
        cached: false,
        vocalUrl: "/api/vocals/abc",
        originalUrl: "/api/original/abc",
      }),
    ).toThrow("invalid response");
  });

  it("parses the saved song library", () => {
    const songs = parseSavedSongs({
      songs: [
        {
          name: "Warmup",
          duration: 90,
          eventCount: 120,
          analyzer: "test",
          cacheKey: "abc",
          savedAt: "2026-09-05T10:00:00+00:00",
        },
      ],
    });

    expect(songs).toHaveLength(1);
    expect(songs[0].eventCount).toBe(120);
  });

  it("rejects malformed saved song entries", () => {
    expect(() =>
      parseSavedSongs({ songs: [{ name: "Missing fields" }] }),
    ).toThrow("invalid response");
  });
});
