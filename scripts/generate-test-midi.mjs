import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import midiPackage from "@tonejs/midi";

const { Midi } = midiPackage;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "samples");
const outputPath = resolve(outputDirectory, "singtrainer-test-melody.mid");

const midi = new Midi();
midi.name = "SingTrainer C Major Warmup";
midi.header.setTempo(84);

const melody = midi.addTrack();
melody.name = "Lead vocal";
melody.instrument.number = 53;

const melodyNotes = [
  [60, 0, 0.7],
  [62, 0.75, 0.7],
  [64, 1.5, 0.7],
  [65, 2.25, 0.7],
  [67, 3, 1.4],
  [65, 4.5, 0.7],
  [64, 5.25, 0.7],
  [62, 6, 0.7],
  [60, 6.75, 1.4],
  [64, 8.25, 0.7],
  [65, 9, 0.7],
  [67, 9.75, 0.7],
  [69, 10.5, 1.4],
  [67, 12, 0.7],
  [64, 12.75, 0.7],
  [62, 13.5, 0.7],
  [60, 14.25, 2.1],
];

for (const [midiNote, time, duration] of melodyNotes) {
  melody.addNote({ midi: midiNote, time, duration, velocity: 0.85 });
}

const piano = midi.addTrack();
piano.name = "Piano accompaniment";
piano.instrument.number = 0;

const chords = [
  [[48, 52, 55], 0],
  [[53, 57, 60], 4.5],
  [[55, 59, 62], 8.25],
  [[48, 52, 55], 12],
];

for (const [notes, time] of chords) {
  for (const midiNote of notes) {
    piano.addNote({ midi: midiNote, time, duration: 3.75, velocity: 0.35 });
  }
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, midi.toArray());

console.log(outputPath);
