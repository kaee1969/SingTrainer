# Skill: Vocal Extraction & Target Melody Generation (v3)

This pipeline converts a full song audio file into the same note-event timeline format used by the v2 comparison engine: `{ startTime, endTime, midiNote }[]`. It runs once per song (offline/local), not in real time.

## Pipeline
1. **Source audio**: a full song file the user has legitimate access to (owned file, personally captured via loopback for private practice, or licensed stems). Not fetched live from any streaming API.
2. **Vocal separation**: run Demucs (open-source, Meta/Facebook Research) locally to split the mix into stems and isolate the vocal track. CPU works but is slow (~minutes per song); GPU is much faster if available.
3. **Pitch extraction**: run CREPE (neural pitch tracker) or pYIN on the isolated vocal stem to get a continuous fundamental-frequency curve over time — much more accurate on a clean single-voice signal than it would be on the full mix.
4. **Convert to note events**: segment the continuous pitch curve into discrete note events (group contiguous frames with similar pitch into a single `{ startTime, endTime, midiNote }` entry), smoothing over brief gaps (e.g. consonants/breaths) so it doesn't fragment into hundreds of tiny notes.
5. **Cache the result**: store the resulting note-event list as a JSON file per song. This is a one-time cost — never re-run the pipeline on the same song twice.

## Why this two-step approach (separate, then extract) matters
- Running pitch detection directly on the full mix (vocals + instruments together) produces garbage — the algorithm will lock onto whatever's loudest in a given frame (bass, guitar, drums), not the melody.
- Isolating the vocal first gives a near-monophonic signal, which is exactly the condition pitch detectors are designed for.

## Loopback capture note (personal use only)
- If sourcing audio via OS-level loopback (BlackHole on Mac, VB-Cable on Windows) from a streaming service: this captures the decoded audio after DRM decryption, output to the sound device, not the encrypted stream itself.
- This is a personal, local, non-distributed workflow — keep it that way. Do not build this into a shareable feature or a hosted service.
