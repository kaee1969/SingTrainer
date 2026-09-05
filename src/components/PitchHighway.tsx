import { useMemo } from "react";
import { frequencyToMidi, midiToNoteName } from "../audio/note-utils";
import type { NoteEvent, PitchReading } from "../audio/types";

const LOOK_AHEAD_SECONDS = 6;
const PLAYHEAD_PERCENT = 18;
const PAST_SECONDS =
  LOOK_AHEAD_SECONDS * (PLAYHEAD_PERCENT / (100 - PLAYHEAD_PERCENT));

interface PitchHighwayProps {
  events: NoteEvent[];
  currentTime: number;
  activeNote: NoteEvent | null;
  reading: PitchReading | null;
  playing: boolean;
  countdown: number | null;
}

function pitchPosition(midiNote: number, minimum: number, maximum: number) {
  return ((maximum - midiNote) / (maximum - minimum)) * 100;
}

export function PitchHighway({
  events,
  currentTime,
  activeNote,
  reading,
  playing,
  countdown,
}: PitchHighwayProps) {
  const { minimumPitch, maximumPitch, gridNotes } = useMemo(() => {
    const notes = events.map((event) => event.midiNote);
    const rawMinimum = Math.min(...notes);
    const rawMaximum = Math.max(...notes);
    const center = (rawMinimum + rawMaximum) / 2;
    const range = Math.max(12, rawMaximum - rawMinimum + 4);
    const minimumPitch = Math.floor(center - range / 2);
    const maximumPitch = Math.ceil(center + range / 2);
    const gridNotes = Array.from(
      { length: maximumPitch - minimumPitch + 1 },
      (_, index) => minimumPitch + index,
    );

    return { minimumPitch, maximumPitch, gridNotes };
  }, [events]);

  const visibleNotes = events.filter(
    (event) =>
      event.endTime >= currentTime - PAST_SECONDS &&
      event.startTime <= currentTime + LOOK_AHEAD_SECONDS,
  );
  const singerMidi = reading ? frequencyToMidi(reading.frequency) : null;
  const singerVisible =
    singerMidi !== null &&
    singerMidi >= minimumPitch &&
    singerMidi <= maximumPitch;

  return (
    <section
      className={`pitch-highway ${playing ? "moving" : ""}`}
      aria-label="Scrolling target melody and current sung pitch"
    >
      <div className="highway-caption">
        <span>Pitch</span>
        <span>{playing ? "Notes move toward the line" : "Melody preview"}</span>
      </div>

      <div className="highway-stage">
        {countdown !== null && (
          <div className="warmup-countdown" role="status">
            <span>Warm up</span>
            <strong>{countdown}</strong>
          </div>
        )}

        {gridNotes.map((note) => (
          <div
            className={`pitch-grid-line ${note % 12 === 0 ? "octave" : ""}`}
            key={note}
            style={{
              top: `${pitchPosition(note, minimumPitch, maximumPitch)}%`,
            }}
          >
            {note % 12 === 0 && <span>{midiToNoteName(note)}</span>}
          </div>
        ))}

        <div
          className="playhead-line"
          style={{ left: `${PLAYHEAD_PERCENT}%` }}
          aria-hidden="true"
        >
          <span>NOW</span>
        </div>

        {visibleNotes.map((event, index) => {
          const left =
            PLAYHEAD_PERCENT +
            ((event.startTime - currentTime) / LOOK_AHEAD_SECONDS) *
              (100 - PLAYHEAD_PERCENT);
          const width = Math.max(
            2.5,
            ((event.endTime - event.startTime) / LOOK_AHEAD_SECONDS) *
              (100 - PLAYHEAD_PERCENT),
          );
          const isActive = event === activeNote;

          return (
            <div
              className={`target-note-bar ${isActive ? "active" : ""}`}
              key={`${event.startTime}-${event.midiNote}-${index}`}
              style={{
                left: `${left}%`,
                top: `${pitchPosition(
                  event.midiNote,
                  minimumPitch,
                  maximumPitch,
                )}%`,
                width: `${width}%`,
              }}
              title={`${midiToNoteName(event.midiNote)} at ${event.startTime.toFixed(1)} seconds`}
            >
              <span>{midiToNoteName(event.midiNote)}</span>
            </div>
          );
        })}

        {singerVisible && reading && (
          <div
            className="singer-indicator"
            style={{
              left: `${PLAYHEAD_PERCENT}%`,
              top: `${pitchPosition(singerMidi, minimumPitch, maximumPitch)}%`,
            }}
            aria-label={`You are singing ${reading.note}`}
          >
            <i />
            <strong>{reading.note}</strong>
          </div>
        )}
      </div>

      <div className="highway-legend" aria-hidden="true">
        <span className="target-key">Target melody</span>
        <span className="voice-key">Your voice</span>
      </div>
    </section>
  );
}
