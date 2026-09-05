export interface PitchReading {
  frequency: number;
  note: string;
  cents: number;
  confidence: number;
}

export interface NoteEvent {
  startTime: number;
  endTime: number;
  midiNote: number;
}
