import type { NoteEvent } from "./types";

export interface AnalyzedSong {
  name: string;
  duration: number;
  events: NoteEvent[];
  analyzer: string;
  cacheKey: string;
  cached: boolean;
  vocalUrl: string;
  originalUrl: string;
}

export interface SavedSongSummary {
  name: string;
  duration: number;
  eventCount: number;
  analyzer: string;
  cacheKey: string;
  savedAt: string;
}

function isNoteEvent(value: unknown): value is NoteEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.startTime === "number" &&
    typeof event.endTime === "number" &&
    typeof event.midiNote === "number" &&
    event.endTime > event.startTime
  );
}

export function parseAnalyzedSong(value: unknown): AnalyzedSong {
  if (!value || typeof value !== "object") {
    throw new Error("The analysis service returned an invalid response");
  }

  const response = value as Record<string, unknown>;
  if (
    typeof response.name !== "string" ||
    typeof response.duration !== "number" ||
    !Array.isArray(response.events) ||
    !response.events.every(isNoteEvent) ||
    typeof response.analyzer !== "string" ||
    typeof response.cacheKey !== "string" ||
    typeof response.cached !== "boolean" ||
    typeof response.vocalUrl !== "string" ||
    typeof response.originalUrl !== "string"
  ) {
    throw new Error("The analysis service returned an invalid response");
  }

  return {
    name: response.name,
    duration: response.duration,
    events: response.events,
    analyzer: response.analyzer,
    cacheKey: response.cacheKey,
    cached: response.cached,
    vocalUrl: response.vocalUrl,
    originalUrl: response.originalUrl,
  };
}

export function parseSavedSongs(value: unknown): SavedSongSummary[] {
  if (!value || typeof value !== "object") {
    throw new Error("The saved song library returned an invalid response");
  }

  const songs = (value as Record<string, unknown>).songs;
  if (!Array.isArray(songs)) {
    throw new Error("The saved song library returned an invalid response");
  }

  return songs.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("The saved song library returned an invalid response");
    }

    const song = value as Record<string, unknown>;
    if (
      typeof song.name !== "string" ||
      typeof song.duration !== "number" ||
      typeof song.eventCount !== "number" ||
      typeof song.analyzer !== "string" ||
      typeof song.cacheKey !== "string" ||
      typeof song.savedAt !== "string"
    ) {
      throw new Error("The saved song library returned an invalid response");
    }

    return {
      name: song.name,
      duration: song.duration,
      eventCount: song.eventCount,
      analyzer: song.analyzer,
      cacheKey: song.cacheKey,
      savedAt: song.savedAt,
    };
  });
}
