import type { NoteEvent } from "./types";

export class SongAudioPlayer {
  private audio: HTMLAudioElement | null = null;

  get currentTime(): number {
    return this.audio?.currentTime ?? 0;
  }

  setSource(url: string): void {
    this.stop();
    this.audio = new Audio(url);
    this.audio.preload = "auto";
  }

  async prepare(): Promise<void> {
    if (!this.audio) throw new Error("No song audio has been loaded");

    this.audio.currentTime = 0;
    this.audio.muted = true;
    await this.audio.play();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.muted = false;
  }

  play(): Promise<void>;
  play(events: NoteEvent[]): Promise<void>;
  async play(): Promise<void> {
    if (!this.audio) throw new Error("No song audio has been loaded");
    this.audio.currentTime = 0;
    await this.audio.play();
  }

  stop(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  dispose(): void {
    this.stop();
    this.audio = null;
  }
}
