import { describe, expect, it } from "vitest";
import { parseAnalyzedSong } from "./song-analysis";

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
      }),
    ).toThrow("invalid response");
  });
});
