import { describe, expect, it } from "vitest";
import { findActiveLyricIndex, parseSyncedLyrics } from "./lyrics";

const lyrics = {
  trackName: "Test",
  artistName: "Singer",
  source: "LRCLIB",
  lines: [
    { startTime: 1, endTime: 3, text: "First line" },
    { startTime: 3, endTime: 5, text: "Second line" },
  ],
};

describe("synced lyrics", () => {
  it("parses timed lyric lines", () => {
    expect(parseSyncedLyrics(lyrics).lines).toHaveLength(2);
  });

  it("finds the current line", () => {
    expect(findActiveLyricIndex(lyrics.lines, 0)).toBe(-1);
    expect(findActiveLyricIndex(lyrics.lines, 1.5)).toBe(0);
    expect(findActiveLyricIndex(lyrics.lines, 3.2)).toBe(1);
  });
});
