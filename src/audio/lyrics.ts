export interface LyricLine {
  startTime: number;
  endTime: number;
  text: string;
}

export interface SyncedLyrics {
  trackName: string;
  artistName: string;
  source: string;
  lines: LyricLine[];
}

export function parseSyncedLyrics(value: unknown): SyncedLyrics {
  if (!value || typeof value !== "object") {
    throw new Error("The lyrics service returned an invalid response");
  }

  const lyrics = value as Record<string, unknown>;
  if (
    typeof lyrics.trackName !== "string" ||
    typeof lyrics.artistName !== "string" ||
    typeof lyrics.source !== "string" ||
    !Array.isArray(lyrics.lines)
  ) {
    throw new Error("The lyrics service returned an invalid response");
  }

  const lines = lyrics.lines.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("The lyrics service returned an invalid response");
    }
    const line = value as Record<string, unknown>;
    if (
      typeof line.startTime !== "number" ||
      typeof line.endTime !== "number" ||
      typeof line.text !== "string" ||
      line.endTime < line.startTime
    ) {
      throw new Error("The lyrics service returned an invalid response");
    }
    return {
      startTime: line.startTime,
      endTime: line.endTime,
      text: line.text,
    };
  });

  return {
    trackName: lyrics.trackName,
    artistName: lyrics.artistName,
    source: lyrics.source,
    lines,
  };
}

export function findActiveLyricIndex(
  lines: LyricLine[],
  currentTime: number,
): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTime >= lines[index].startTime) return index;
  }
  return -1;
}
