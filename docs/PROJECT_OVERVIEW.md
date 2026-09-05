# Project Overview — SingTrainer

## What this is
A personal tool (not a product) to practice singing in tune. You pick a song or a melody, sing along, and get real-time feedback on your pitch accuracy compared to the correct notes — similar to what Smule/karaoke apps do internally, but built for personal use and honest cents-level feedback instead of a gamified score.

## Why not just use Spotify's API or an existing app?
- Spotify deprecated its `audio-features`/`audio-analysis` endpoints for all new apps in Nov 2024 — there is no official way to pull melody/pitch data from their API.
- Spotify streams are DRM-protected; their official SDKs block raw audio access by design.
- Karaoke apps like Smule blend pitch accuracy with volume/timing into a gamified score — not precise enough for real practice, per independent testing (users found scores as high as 94% while pitch was actually ±42 cents off).
- This project is for personal use only — not intended for distribution, so there's flexibility in how the reference audio is sourced (see "Reference audio" below), but that flexibility should not be assumed if this project is ever shared or published.

## Core problem split
1. **Detecting the pitch of your own voice in real time** — solved, well-understood DSP. Do this client-side in the browser via Web Audio API + a pitch detection library.
2. **Knowing the correct target pitch at each moment in a song** — harder, because a song's mix has vocals + instruments combined. Needs either a pre-made melody (MIDI) or vocal isolation (Demucs) + pitch extraction (CREPE/pYIN) run on an isolated vocal stem.

## Roadmap

### v1 — Note trainer (MVP)
- Show a single target note (or short fixed pattern).
- Capture mic input, run real-time pitch detection.
- Display live cents-deviation feedback (needle or rolling graph).
- No backend, no file upload, no song audio at all yet.

### v2 — MIDI melody trainer
- User supplies a MIDI file containing the target vocal melody (many free vocal-melody MIDI transcriptions exist for popular songs).
- Parse MIDI into note-event timeline: `{ startTime, endTime, midiNote }[]`.
- Play the melody/backing track in sync, compare live mic pitch against the timeline in real time.
- Score/visualize accuracy per note and over the whole take.

### v3 — Full song input
- User supplies any song audio file they have rights to use (own files, or personally captured via loopback for private practice — see note below).
- Run Demucs locally to isolate the vocal stem from the mix.
- Run CREPE or pYIN on the isolated vocal to extract a continuous pitch curve.
- Convert that pitch curve into the same note-event timeline format used in v2, cache it as JSON per song.
- Reuse the exact same comparison/scoring engine from v2 — v3 only changes how the target timeline is produced, not how it's used.

## Reference audio sourcing (v3, personal use)
- Spotify audio can be captured via OS-level loopback (e.g. BlackHole on Mac, VB-Cable on Windows) routing system output into an input the browser reads like a microphone.
- This is for personal practice only — it is not for redistribution and conflicts with Spotify's terms of service, so it should stay a private, local workflow and not become a shareable feature if this project ever grows beyond personal use.
- Preferred alternative when available: user's own purchased/owned audio files, royalty-free tracks, or licensed karaoke/acapella stem packs — avoids the DRM/ToS question entirely.

## Tech stack
- Frontend: React + TypeScript + Vite, all client-side for v1/v2.
- Pitch detection (mic, real-time): Pitchy (McLeod Pitch Method, JS/WASM).
- MIDI parsing/playback: `@tonejs/midi` + Tone.js.
- v3 backend (local, not hosted): Python service running Demucs (vocal separation) + CREPE or pYIN (pitch extraction from isolated vocal).
- No paid APIs required anywhere in this stack — everything runs locally.

## Known technical pitfalls to design around
- Raw pitch detector output is jittery frame-to-frame — smooth with a moving average or median filter before display/scoring.
- Autocorrelation-based detectors are prone to octave errors on voice — test explicitly for this.
- Silence/noise can produce false pitch readings — gate on the detector's confidence score plus a volume floor.
- Mic/room conditions vary — a short calibration step (sing a known note, or sample ambient noise for a couple seconds) meaningfully improves accuracy.
