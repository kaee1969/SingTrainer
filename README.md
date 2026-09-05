# SingTrainer

A private, browser-based singing pitch trainer. Everything runs locally in the
browser; microphone audio and MIDI files are never uploaded.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Microphone access requires `localhost` or a
secure HTTPS page; opening `index.html` directly will not run the app.

## Practice modes

- **Single note:** match A4 (440 Hz) and use the live cents meter.
- **MIDI song:** choose a `.mid` or `.midi` file, select the vocal/melody track
  if the file has several parts, then sing with the synthesized guide melody.
- **Song audio:** send an owned local audio file to the local Python service,
  isolate its vocals with Demucs, extract the melody with pYIN, and practice
  against the extracted vocal stem. Analysis results and vocal stems are cached
  by file hash.

Headphones are recommended in MIDI mode so the guide melody does not bleed into
the microphone.

## V3 local analysis setup

V3 needs Python 3.12 and `uv`. The first setup installs PyTorch, Demucs, pYIN,
and the local API dependencies, so it is significantly larger than the browser
app:

```sh
npm run setup:v3
npm run server
```

Keep the server running in one terminal, then run `npm run dev` in another. The
first song analysis also downloads the fine-tuned Demucs vocal model and can take
several minutes on CPU. It uses higher-overlap processing for a cleaner vocal stem,
so extraction is slower than the standard Demucs preset. Later analyses of the
exact same file use `server/cache/`.

Completed analyses appear in the app's **Saved songs** list. The local server
stores the extracted vocal and melody timeline, so refreshing the browser does
not require choosing or analysing the original song again.

Song files are posted only to `127.0.0.1`; the service runs locally and does not
upload audio to any external service. Use audio you own or are licensed to use.

A ready-to-use two-track test file is included at
`samples/singtrainer-test-melody.mid`.

## Checks

```sh
npm test
npm run test:server
npm run lint
npm run build
```
