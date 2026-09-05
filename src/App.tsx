import { useEffect, useMemo, useRef, useState } from "react";
import { MelodyPlayer } from "./audio/melody-player";
import { parseSyncedLyrics, type SyncedLyrics } from "./audio/lyrics";
import { MicPitchTracker } from "./audio/mic-pitch-tracker";
import { midiToFrequency, midiToNoteName } from "./audio/note-utils";
import {
  deviationFromMidi,
  findActiveNote,
  MelodyScorer,
  type ScoreSummary,
} from "./audio/pitch-comparison";
import type { NoteEvent, PitchReading } from "./audio/types";
import { SongAudioPlayer } from "./audio/song-audio-player";
import {
  parseAnalyzedSong,
  parseSavedSongs,
  type AnalyzedSong,
  type SavedSongSummary,
} from "./audio/song-analysis";
import { PitchHighway } from "./components/PitchHighway";
import { LyricsTracker } from "./components/LyricsTracker";
import {
  parseMidiFile,
  type MelodyTrack,
  type ParsedMidi,
} from "./midi/midi-parser";

const FIXED_TARGET: NoteEvent = {
  startTime: 0,
  endTime: Number.POSITIVE_INFINITY,
  midiNote: 69,
};
const EMPTY_SCORE: ScoreSummary = {
  accuracy: 0,
  coverage: 0,
  averageError: 0,
  scoredFrames: 0,
};
const METER_RANGE = 50;
const IN_TUNE_CENTS = 10;
const VOICE_MARKER_HOLD_MS = 1_000;

type Mode = "note" | "midi" | "audio";
type MicState = "idle" | "starting" | "listening" | "error";
type PlaybackState = "idle" | "starting" | "countdown" | "playing" | "finished";
type AnalysisState = "idle" | "analyzing" | "loading" | "ready" | "error";
type LyricsState = "idle" | "loading" | "ready" | "unavailable";

interface PracticeMelody {
  name: string;
  duration: number;
  events: NoteEvent[];
}

function getMicErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow it in your browser, then try again.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found on this device.";
  }

  return "The microphone could not be started. Check your browser settings and try again.";
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function App() {
  const [mode, setMode] = useState<Mode>("note");
  const [micState, setMicState] = useState<MicState>("idle");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [indicatorReading, setIndicatorReading] = useState<PitchReading | null>(
    null,
  );
  const [activeNote, setActiveNote] = useState<NoteEvent | null>(null);
  const [midi, setMidi] = useState<ParsedMidi | null>(null);
  const [analyzedSong, setAnalyzedSong] = useState<AnalyzedSong | null>(null);
  const [savedSongs, setSavedSongs] = useState<SavedSongSummary[]>([]);
  const [lyrics, setLyrics] = useState<SyncedLyrics | null>(null);
  const [lyricsState, setLyricsState] = useState<LyricsState>("idle");
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [selectedTrackId, setSelectedTrackId] = useState(-1);
  const [position, setPosition] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [score, setScore] = useState<ScoreSummary>(EMPTY_SCORE);
  const [errorMessage, setErrorMessage] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [deletingSongKey, setDeletingSongKey] = useState<string | null>(null);

  const trackerRef = useRef<MicPitchTracker | null>(null);
  const playerRef = useRef(new MelodyPlayer());
  const songPlayerRef = useRef(new SongAudioPlayer());
  const scorerRef = useRef(new MelodyScorer());
  const readingRef = useRef<PitchReading | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const indicatorTimeoutRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const lyricsRequestRef = useRef(0);

  const selectedTrack = useMemo<MelodyTrack | null>(
    () => midi?.tracks.find((track) => track.id === selectedTrackId) ?? null,
    [midi, selectedTrackId],
  );

  const practiceMelody = useMemo<PracticeMelody | null>(() => {
    if (mode === "midi") return selectedTrack;
    if (mode === "audio" && analyzedSong) {
      return {
        name: analyzedSong.name,
        duration: analyzedSong.duration,
        events: analyzedSong.events,
      };
    }
    return null;
  }, [analyzedSong, mode, selectedTrack]);

  const target = mode === "note" ? FIXED_TARGET : activeNote;
  const targetFrequency = target ? midiToFrequency(target.midiNote) : null;
  const deviation =
    reading && target ? deviationFromMidi(reading, target.midiNote) : null;
  const meterPosition = Math.max(
    -METER_RANGE,
    Math.min(METER_RANGE, deviation ?? 0),
  );
  const isInTune = deviation !== null && Math.abs(deviation) <= IN_TUNE_CENTS;
  const playing = playbackState === "playing";
  const practiceActive = playing || playbackState === "countdown";
  const listening = micState === "listening";
  const progress = practiceMelody
    ? Math.min(100, (position / practiceMelody.duration) * 100)
    : 0;
  const analysisBusy =
    analysisState === "analyzing" || analysisState === "loading";

  useEffect(() => {
    const player = playerRef.current;
    const songPlayer = songPlayerRef.current;

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (indicatorTimeoutRef.current !== null) {
        window.clearTimeout(indicatorTimeoutRef.current);
      }
      void trackerRef.current?.stop();
      player.dispose();
      songPlayer.dispose();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/songs", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        setSavedSongs(parseSavedSongs(await response.json()));
      })
      .catch(() => {
        // The server may not be running while using the browser-only modes.
      });

    return () => controller.abort();
  }, []);

  function handlePitch(nextReading: PitchReading | null) {
    readingRef.current = nextReading;
    setReading(nextReading);

    if (nextReading) {
      if (indicatorTimeoutRef.current !== null) {
        window.clearTimeout(indicatorTimeoutRef.current);
        indicatorTimeoutRef.current = null;
      }
      setIndicatorReading(nextReading);
    } else if (indicatorTimeoutRef.current === null) {
      indicatorTimeoutRef.current = window.setTimeout(() => {
        setIndicatorReading(null);
        indicatorTimeoutRef.current = null;
      }, VOICE_MARKER_HOLD_MS);
    }
  }

  async function ensureMicrophone(): Promise<void> {
    if (trackerRef.current) return;

    setMicState("starting");
    setErrorMessage("");
    const tracker = new MicPitchTracker(handlePitch);
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setMicState("listening");
    } catch (error) {
      trackerRef.current = null;
      setMicState("error");
      setErrorMessage(getMicErrorMessage(error));
      throw error;
    }
  }

  async function stopMicrophone(): Promise<void> {
    await trackerRef.current?.stop();
    trackerRef.current = null;
    readingRef.current = null;
    setReading(null);
    setMicState("idle");
  }

  function stopPlayback(finished = false): void {
    sessionIdRef.current += 1;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    playerRef.current.stop();
    songPlayerRef.current.stop();
    setCountdown(null);
    setActiveNote(null);
    setPlaybackState(finished ? "finished" : "idle");
  }

  async function stopMidiPractice(finished = false): Promise<void> {
    stopPlayback(finished);
    await stopMicrophone();
  }

  async function switchMode(nextMode: Mode): Promise<void> {
    if (nextMode === mode) return;
    stopPlayback();
    await stopMicrophone();
    setErrorMessage("");
    setMode(nextMode);
  }

  async function handleNoteTrainerButton() {
    if (listening) {
      await stopMicrophone();
      return;
    }

    try {
      await ensureMicrophone();
    } catch {
      // The user-facing microphone error is set by ensureMicrophone.
    }
  }

  async function loadMidi(file: File): Promise<void> {
    stopPlayback();
    setFileBusy(true);
    setErrorMessage("");

    try {
      const parsed = parseMidiFile(await file.arrayBuffer(), file.name);
      setMidi(parsed);
      setSelectedTrackId(parsed.suggestedTrackId);
      setPosition(0);
      setScore(EMPTY_SCORE);
    } catch {
      setMidi(null);
      setSelectedTrackId(-1);
      setErrorMessage(
        "That file could not be read as a MIDI melody. Try another .mid or .midi file.",
      );
    } finally {
      setFileBusy(false);
    }
  }

  async function analyzeAudio(file: File): Promise<void> {
    stopPlayback();
    setAnalysisState("analyzing");
    setErrorMessage("");
    setAnalyzedSong(null);
    setLyrics(null);
    setLyricsState("idle");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const detail =
          body && typeof body === "object" && "detail" in body
            ? String((body as { detail: unknown }).detail)
            : "The local analysis service could not process this song.";
        throw new Error(detail);
      }

      const result = parseAnalyzedSong(body);
      songPlayerRef.current.setSource(result.originalUrl);
      setAnalyzedSong(result);
      setAnalysisState("ready");
      setPosition(0);
      setScore(EMPTY_SCORE);
      void refreshSavedSongs();
      void loadLyrics(result.cacheKey);
    } catch (error) {
      setAnalysisState("error");
      setErrorMessage(
        error instanceof TypeError
          ? "Could not reach the local analysis service. Run npm run server and try again."
          : error instanceof Error
            ? error.message
            : "Could not reach the local analysis service. Run npm run server and try again.",
      );
    }
  }

  async function refreshSavedSongs(): Promise<void> {
    try {
      const response = await fetch("/api/songs");
      if (!response.ok) return;
      setSavedSongs(parseSavedSongs(await response.json()));
    } catch {
      // Loading a song still succeeds if refreshing the library fails.
    }
  }

  async function loadSavedSong(cacheKey: string): Promise<void> {
    stopPlayback();
    setAnalysisState("loading");
    setErrorMessage("");
    setLyrics(null);
    setLyricsState("idle");

    try {
      const response = await fetch(`/api/songs/${cacheKey}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error("That saved song is no longer available.");
      }

      const result = parseAnalyzedSong(body);
      songPlayerRef.current.setSource(result.originalUrl);
      setAnalyzedSong(result);
      setAnalysisState("ready");
      setPosition(0);
      setScore(EMPTY_SCORE);
      void loadLyrics(result.cacheKey);
    } catch (error) {
      setAnalysisState("error");
      setErrorMessage(
        error instanceof TypeError
          ? "Could not reach the local song library. Run npm run server and try again."
          : error instanceof Error
            ? error.message
            : "Could not load that saved song.",
      );
    }
  }

  async function deleteSavedSong(song: SavedSongSummary): Promise<void> {
    if (!window.confirm(`Delete “${song.name}” from your saved songs?`)) return;

    setDeletingSongKey(song.cacheKey);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/songs/${song.cacheKey}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("That saved song could not be deleted.");
      }

      setSavedSongs((songs) =>
        songs.filter((savedSong) => savedSong.cacheKey !== song.cacheKey),
      );

      if (analyzedSong?.cacheKey === song.cacheKey) {
        stopPlayback();
        songPlayerRef.current.dispose();
        lyricsRequestRef.current += 1;
        setAnalyzedSong(null);
        setAnalysisState("idle");
        setLyrics(null);
        setLyricsState("idle");
        setPosition(0);
        setScore(EMPTY_SCORE);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof TypeError
          ? "Could not reach the local song library. Run npm run server and try again."
          : error instanceof Error
            ? error.message
            : "That saved song could not be deleted.",
      );
    } finally {
      setDeletingSongKey(null);
    }
  }

  async function loadLyrics(cacheKey: string): Promise<void> {
    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;
    setLyricsState("loading");

    try {
      const response = await fetch(`/api/lyrics/${cacheKey}`);
      const body: unknown = await response.json().catch(() => null);
      if (lyricsRequestRef.current !== requestId) return;
      if (!response.ok) {
        setLyrics(null);
        setLyricsState("unavailable");
        return;
      }

      setLyrics(parseSyncedLyrics(body));
      setLyricsState("ready");
    } catch {
      if (lyricsRequestRef.current !== requestId) return;
      setLyrics(null);
      setLyricsState("unavailable");
    }
  }

  async function startPractice(): Promise<void> {
    if (!practiceMelody) return;

    const practicePlayer =
      mode === "audio" ? songPlayerRef.current : playerRef.current;

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    setPlaybackState("starting");
    setErrorMessage("");
    scorerRef.current = new MelodyScorer();
    setScore(EMPTY_SCORE);
    setPosition(0);

    try {
      const audioReady = practicePlayer.prepare();
      await ensureMicrophone();
      await audioReady;
      if (sessionIdRef.current !== sessionId) return;

      setPlaybackState("countdown");
      setCountdown(3);
      setActiveNote(practiceMelody.events[0] ?? null);

      let countdownStartedAt: number | null = null;
      const updateCountdown = (timestamp: number) => {
        if (sessionIdRef.current !== sessionId) return;

        countdownStartedAt ??= timestamp;
        const elapsed = timestamp - countdownStartedAt;
        if (elapsed < 3_000) {
          setCountdown(Math.ceil((3_000 - elapsed) / 1_000));
          animationFrameRef.current = requestAnimationFrame(updateCountdown);
          return;
        }

        setCountdown(null);
        void beginPracticePlayback(practiceMelody, practicePlayer, sessionId);
      };

      animationFrameRef.current = requestAnimationFrame(updateCountdown);
    } catch {
      stopPlayback();
    }
  }

  async function beginPracticePlayback(
    track: PracticeMelody,
    practicePlayer: MelodyPlayer | SongAudioPlayer,
    sessionId: number,
  ): Promise<void> {
    try {
      await practicePlayer.play(track.events);
      if (sessionIdRef.current !== sessionId) {
        practicePlayer.stop();
        return;
      }

      setPlaybackState("playing");

      const update = () => {
        if (sessionIdRef.current !== sessionId) return;

        const nextPosition = practicePlayer.currentTime;
        const nextTarget = findActiveNote(track.events, nextPosition);

        setPosition(nextPosition);
        setActiveNote(nextTarget);
        scorerRef.current.addFrame(nextTarget, readingRef.current);
        setScore(scorerRef.current.summary());

        if (nextPosition >= track.duration) {
          void stopMidiPractice(true);
          return;
        }

        animationFrameRef.current = requestAnimationFrame(update);
      };

      animationFrameRef.current = requestAnimationFrame(update);
    } catch {
      setErrorMessage(
        "Melody playback could not be started. Please try again.",
      );
      stopPlayback();
    }
  }

  const feedback = (() => {
    if (mode !== "note" && playbackState === "countdown") {
      return `Warm up your voice — melody starts in ${countdown ?? 1}.`;
    }
    if (mode === "midi" && !playing) {
      return selectedTrack
        ? "Press start when you are ready to sing."
        : "Choose a MIDI melody to begin.";
    }
    if (mode === "audio" && !playing) {
      if (analysisState === "analyzing") {
        return "Separating vocals and extracting the melody…";
      }
      return practiceMelody
        ? "Press start when you are ready to sing with the song."
        : "Choose a local song file to begin.";
    }
    if (!listening) return "Start the microphone when you are ready.";
    if (mode !== "note" && !target) return "Rest — listen for the next note.";
    if (!reading) return "Sing and hold the target note.";
    if (isInTune) return "In tune";
    return (deviation ?? 0) < 0
      ? "A little flat — sing higher."
      : "A little sharp — sing lower.";
  })();

  return (
    <main className="app-shell">
      <section className="trainer" aria-labelledby="page-title">
        <header className="app-header">
          <div className="brand-mark" aria-hidden="true">
            ♪
          </div>
          <div>
            <h1 id="page-title">SingTrainer</h1>
            <p>Match the note. Watch the needle.</p>
          </div>
        </header>

        <div className="mode-switch" aria-label="Practice mode">
          <button
            className={mode === "note" ? "active" : ""}
            type="button"
            onClick={() => void switchMode("note")}
          >
            Single note
          </button>
          <button
            className={mode === "midi" ? "active" : ""}
            type="button"
            onClick={() => void switchMode("midi")}
          >
            MIDI song
          </button>
          <button
            className={mode === "audio" ? "active" : ""}
            type="button"
            onClick={() => void switchMode("audio")}
          >
            Song audio
          </button>
        </div>

        {mode === "midi" && (
          <section className="midi-panel" aria-label="MIDI melody">
            <label className="file-picker">
              <span>{fileBusy ? "Reading file…" : "Choose MIDI file"}</span>
              <input
                type="file"
                accept=".mid,.midi,audio/midi,audio/x-midi"
                disabled={fileBusy || practiceActive}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadMidi(file);
                  event.target.value = "";
                }}
              />
            </label>

            {midi && selectedTrack && (
              <div className="song-details">
                <div className="song-heading">
                  <div>
                    <span className="eyebrow">Loaded melody</span>
                    <strong>{midi.name}</strong>
                  </div>
                  <span>{formatTime(selectedTrack.duration)}</span>
                </div>

                {midi.tracks.length > 1 && (
                  <label className="track-select">
                    <span>Melody part</span>
                    <select
                      value={selectedTrackId}
                      disabled={practiceActive}
                      onChange={(event) => {
                        stopPlayback();
                        setSelectedTrackId(Number(event.target.value));
                        setPosition(0);
                        setScore(EMPTY_SCORE);
                      }}
                    >
                      {midi.tracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name} · {track.instrument} ·{" "}
                          {track.events.length} notes
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="song-progress" aria-label="Song progress">
                  <div style={{ width: `${progress}%` }} />
                </div>
                <div className="time-row">
                  <span>{formatTime(position)}</span>
                  <span>{formatTime(selectedTrack.duration)}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {mode === "audio" && (
          <section className="midi-panel" aria-label="Song audio analysis">
            <button
              className="file-picker"
              type="button"
              disabled={analysisBusy || practiceActive}
              onClick={() => audioInputRef.current?.click()}
            >
              <span>
                {analysisState === "analyzing"
                  ? "Analyzing song…"
                  : analysisState === "loading"
                    ? "Loading saved song…"
                    : "Choose owned song audio"}
              </span>
            </button>
            <input
              ref={audioInputRef}
              className="hidden-file-input"
              type="file"
              aria-label="Select song audio file"
              accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg"
              disabled={analysisBusy || practiceActive}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void analyzeAudio(file);
                event.target.value = "";
              }}
            />

            {savedSongs.length > 0 && (
              <div className="saved-song-library">
                <div className="saved-song-library-heading">
                  <span className="eyebrow">Saved songs</span>
                  <span>Stored on this device</span>
                </div>
                <div className="saved-song-list">
                  {savedSongs.map((song) => (
                    <div
                      className={
                        analyzedSong?.cacheKey === song.cacheKey
                          ? "saved-song active"
                          : "saved-song"
                      }
                      key={song.cacheKey}
                    >
                      <button
                        className="saved-song-load"
                        type="button"
                        disabled={
                          analysisBusy ||
                          practiceActive ||
                          deletingSongKey === song.cacheKey
                        }
                        onClick={() => void loadSavedSong(song.cacheKey)}
                      >
                        <span>
                          <strong>{song.name}</strong>
                          <small>{song.eventCount} vocal notes</small>
                        </span>
                        <span>{formatTime(song.duration)}</span>
                      </button>
                      <button
                        className="saved-song-delete"
                        type="button"
                        aria-label={`Delete ${song.name}`}
                        title={`Delete ${song.name}`}
                        disabled={
                          analysisBusy ||
                          practiceActive ||
                          deletingSongKey !== null
                        }
                        onClick={() => void deleteSavedSong(song)}
                      >
                        {deletingSongKey === song.cacheKey ? "…" : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysisState === "analyzing" && (
              <div className="analysis-status" role="status">
                <i />
                <div>
                  <strong>Building the vocal melody</strong>
                  <span>
                    Demucs separation and pitch extraction can take several
                    minutes on CPU. Keep this page open.
                  </span>
                </div>
              </div>
            )}

            {analyzedSong && (
              <div className="song-details">
                <div className="song-heading">
                  <div>
                    <span className="eyebrow">Analyzed song</span>
                    <strong>{analyzedSong.name}</strong>
                  </div>
                  <span>{formatTime(analyzedSong.duration)}</span>
                </div>
                <p className="analysis-meta">
                  {analyzedSong.events.length} vocal notes ·{" "}
                  {analyzedSong.analyzer}
                  {analyzedSong.cached ? " · loaded from cache" : ""}
                </p>
                <div className="song-progress" aria-label="Song progress">
                  <div style={{ width: `${progress}%` }} />
                </div>
                <div className="time-row">
                  <span>{formatTime(position)}</span>
                  <span>{formatTime(analyzedSong.duration)}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {mode !== "note" && practiceMelody ? (
          <>
            <PitchHighway
              events={practiceMelody.events}
              currentTime={position}
              activeNote={activeNote}
              reading={indicatorReading}
              playing={playing}
              countdown={countdown}
            />
            {mode === "audio" && lyrics && (
              <LyricsTracker lyrics={lyrics} currentTime={position} />
            )}
            {mode === "audio" && lyricsState === "loading" && (
              <div className="lyrics-message" role="status">
                Finding time-synced lyrics…
              </div>
            )}
            {mode === "audio" && lyricsState === "unavailable" && (
              <div className="lyrics-message">
                No synced lyrics found. Filenames work best as Artist - Song.
              </div>
            )}
            <div className="live-pitch-row" aria-live="polite">
              <div>
                <span className="eyebrow">Target</span>
                <strong>
                  {target ? midiToNoteName(target.midiNote) : "Rest"}
                </strong>
              </div>
              <div>
                <span className="eyebrow">Your voice</span>
                <strong>{reading?.note ?? "—"}</strong>
                <small>
                  {reading ? `${reading.frequency.toFixed(1)} Hz` : "No pitch"}
                </small>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={`target-card ${!target ? "resting" : ""}`}>
              <span className="eyebrow">
                {mode === "note" ? "Target note" : "Current target"}
              </span>
              <strong>
                {target ? midiToNoteName(target.midiNote) : "Rest"}
              </strong>
              <span>
                {targetFrequency
                  ? `${targetFrequency.toFixed(0)} Hz`
                  : "Next note soon"}
              </span>
            </div>

            <div className="reading" aria-live="polite">
              <span className="eyebrow">You are singing</span>
              <div className="detected-note">{reading?.note ?? "—"}</div>
              <div className="frequency">
                {reading
                  ? `${reading.frequency.toFixed(1)} Hz`
                  : "Waiting for a clear note"}
              </div>
            </div>
          </>
        )}

        <div className={`meter-wrap ${isInTune ? "in-tune" : ""}`}>
          <div className="meter-labels" aria-hidden="true">
            <span>Flat</span>
            <span>In tune</span>
            <span>Sharp</span>
          </div>
          <div
            className="meter"
            role="meter"
            aria-label="Cents from target note"
            aria-valuemin={-METER_RANGE}
            aria-valuemax={METER_RANGE}
            aria-valuenow={Math.round(meterPosition)}
          >
            <div className="tolerance-zone" />
            <div className="center-line" />
            <div
              className={`needle ${reading && target ? "visible" : ""}`}
              style={{ left: `${50 + meterPosition}%` }}
            />
          </div>
          <div className="scale" aria-hidden="true">
            <span>−50</span>
            <span>0 cents</span>
            <span>+50</span>
          </div>
        </div>

        <p className={`feedback ${isInTune ? "success" : ""}`}>{feedback}</p>

        {mode !== "note" && practiceMelody && score.scoredFrames > 0 && (
          <div className="score-grid" aria-label="Practice score">
            <div>
              <strong>{score.accuracy}%</strong>
              <span>within ±50¢</span>
            </div>
            <div>
              <strong>{score.coverage}%</strong>
              <span>notes covered</span>
            </div>
            <div>
              <strong>{score.averageError}¢</strong>
              <span>average error</span>
            </div>
          </div>
        )}

        {errorMessage && (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        )}

        {mode === "note" ? (
          <button
            className={
              listening ? "secondary action-button" : "primary action-button"
            }
            type="button"
            disabled={micState === "starting"}
            onClick={() => void handleNoteTrainerButton()}
          >
            {micState === "starting"
              ? "Starting…"
              : listening
                ? "Stop microphone"
                : "Start microphone"}
          </button>
        ) : (
          <button
            className={
              practiceActive
                ? "secondary action-button"
                : "primary action-button"
            }
            type="button"
            disabled={
              !practiceMelody || playbackState === "starting" || analysisBusy
            }
            onClick={() =>
              void (practiceActive ? stopMidiPractice() : startPractice())
            }
          >
            {playbackState === "starting"
              ? "Starting…"
              : practiceActive
                ? "Stop practice"
                : playbackState === "finished"
                  ? "Sing again"
                  : "Start practice"}
          </button>
        )}

        <p className="privacy-note">
          Files stay on this device and are processed only by the local app.
          {mode === "audio"
            ? " Song name and duration are sent to LRCLIB for lyrics."
            : ""}
          {mode !== "note" ? " Headphones work best." : ""}
        </p>
      </section>
    </main>
  );
}

export default App;
