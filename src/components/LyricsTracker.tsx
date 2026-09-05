import { useEffect, useMemo, useRef } from "react";
import { findActiveLyricIndex, type SyncedLyrics } from "../audio/lyrics";

interface LyricsTrackerProps {
  lyrics: SyncedLyrics;
  currentTime: number;
}

export function LyricsTracker({ lyrics, currentTime }: LyricsTrackerProps) {
  const activeIndex = useMemo(
    () => findActiveLyricIndex(lyrics.lines, currentTime),
    [currentTime, lyrics.lines],
  );
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeIndex]);

  return (
    <section className="lyrics-tracker" aria-label="Synced lyrics">
      <div className="lyrics-heading">
        <span>Lyrics</span>
        <span>{lyrics.source}</span>
      </div>
      <div className="lyrics-lines" aria-live="polite">
        {lyrics.lines.map((line, index) => {
          const distance = activeIndex < 0 ? index + 1 : index - activeIndex;
          return (
            <p
              className={index === activeIndex ? "active" : ""}
              key={`${line.startTime}-${index}`}
              ref={index === activeIndex ? activeLineRef : null}
              style={{
                opacity:
                  index === activeIndex
                    ? 1
                    : Math.max(0.2, 0.48 - Math.abs(distance) * 0.07),
              }}
            >
              {line.text}
            </p>
          );
        })}
      </div>
    </section>
  );
}
