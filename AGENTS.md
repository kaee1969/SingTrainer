# AGENTS.md

## Project
SingTrainer — a personal, browser-based singing pitch trainer. Not for distribution.
Core loop: capture mic audio -> detect pitch -> compare to a target melody -> render real-time feedback (cents deviation, rolling pitch graph).

See `docs/PROJECT_OVERVIEW.md` for full architecture, roadmap (v1/v2/v3), and rationale.
See `skills/pitch-detection.md` and `skills/vocal-extraction.md` before touching those areas.

## Stack
- Frontend: React + TypeScript + Vite. No backend for v1/v2.
- Pitch detection: Pitchy (McLeod Pitch Method) for real-time mic input.
- v3 only: Python service running Demucs (vocal separation) + CREPE/pYIN (pitch extraction).

## Build & test
- `npm install`
- `npm run dev` — local dev server
- `npm test` — vitest unit tests; run before every commit
- `npm run lint` — eslint + prettier check

## Code conventions
- All DSP/audio logic lives in `src/audio/`, framework-agnostic (no React imports there).
- Pitch always represented as `{ frequency, note, cents, confidence }` — never raw Hz alone in UI code.
- Target melodies stored as note-event lists: `{ startTime, endTime, midiNote }[]` — same shape whether sourced from MIDI or extracted vocal audio, so comparison logic never branches on source.
- Apply a moving-average/median smoothing filter to raw pitch frames before display or scoring — raw output is jittery.
- Gate on confidence + volume floor before treating a frame as a real pitch reading (avoid noise/silence false positives).

## Testing notes
- Pitch/note-conversion logic must be unit-testable with synthetic sine wave input (e.g. generate 440Hz -> assert "A4, 0 cents"). No live mic needed in tests.
- Explicitly test for octave errors (common failure mode of autocorrelation-based pitch detectors on voice).

## Scope guardrails
- v1: single target note/short pattern, live mic pitch, real-time cents-deviation meter. No backend.
- v2: user-supplied MIDI melody, timeline-synced playback + scoring.
- v3: user-supplied full song audio -> Demucs vocal separation -> CREPE pitch extraction -> cached target-note-event JSON, reusing the v2 comparison engine.
- Do not add streaming-service API integrations (Spotify, YouTube, etc.) — audio is always user-supplied/local, for personal use only.
- Do not over-build: no auth, no user accounts, no cloud deployment, no config options beyond what's asked for.
