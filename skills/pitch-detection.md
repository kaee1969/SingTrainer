# Skill: Pitch Detection (real-time mic input)

## Algorithm choice
- Use an existing library — do not hand-roll autocorrelation or FFT-based pitch detection from scratch.
- Recommended: **Pitchy** (McLeod Pitch Method), lightweight, good latency for real-time mic input, works well in-browser via WASM.
- Alternative: **aubio.js** (WASM port of aubio, also solid for real-time).
- For offline/high-accuracy extraction from pre-recorded audio (v3, isolated vocal stems), prefer **CREPE** (neural, more accurate but heavier, not real-time-in-browser friendly) or **pYIN** — these run server-side/offline, not in the live mic loop.

## Signal path
1. `getUserMedia` → `AudioContext` → `AnalyserNode` (or raw `ScriptProcessorNode`/`AudioWorklet` for the sample buffer).
2. Feed fixed-size audio frames (e.g. 2048 samples) to the pitch detector each animation frame.
3. Detector returns `{ frequency: number, confidence: number }` (or similar) per frame.
4. Convert frequency → note name + cents deviation (see `note-utils.ts` responsibilities below).
5. Smooth the resulting note/cents stream before it reaches the UI.

## Frequency → note/cents conversion
- Standard formula: `midiNote = 69 + 12 * log2(frequency / 440)`, round to nearest integer for the note, and the remainder (in semitones) * 100 gives cents deviation.
- Keep this as a pure function, unit-testable with known frequencies (A4 = 440Hz → 0 cents, etc.) without any audio hardware involved.

## Known failure modes to guard against
- **Jitter**: raw per-frame pitch readings bounce around even on a steady note. Apply a moving average or median filter over the last 3-5 frames before using the value for display or scoring.
- **Octave errors**: the detector sometimes reports a pitch exactly one octave off the true pitch — a common failure mode of autocorrelation-family algorithms on voice. Worth an explicit test case with real singing samples, not just clean sine waves.
- **False positives on silence/noise**: use the detector's confidence score (Pitchy provides one) and a simple RMS/volume floor — don't treat a frame as "a pitch" unless both are above threshold.
- **Calibration**: mic sensitivity and room noise vary a lot between setups. A short calibration step (ask the user to sing a known reference note, or sample a couple seconds of ambient noise to set the noise floor) meaningfully improves real-world accuracy.

## Testing approach
- Generate synthetic sine waves at known frequencies in test code (no live mic needed) and assert correct note + cents output.
- Test edge cases: frequency exactly between two notes, very quiet signal (should be gated out), rapid pitch glide (should not falsely trigger octave jump).
