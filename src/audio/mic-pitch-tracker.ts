import { PitchDetector } from "pitchy";
import { frequencyToPitch } from "./note-utils";
import { calculateRms, DEFAULT_PITCH_GATE } from "./pitch-analyser";
import { MedianPitchSmoother } from "./pitch-smoother";
import type { PitchReading } from "./types";

export type PitchListener = (reading: PitchReading | null) => void;

export class MicPitchTracker {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private readonly smoother = new MedianPitchSmoother(5);

  constructor(private readonly onPitch: PitchListener) {}

  async start(): Promise<void> {
    if (this.audioContext) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    try {
      const audioContext = new AudioContext();
      await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      this.stream = stream;
      this.audioContext = audioContext;
      this.analyser = analyser;
      this.source = source;
      this.listen();
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();

    const context = this.audioContext;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.smoother.clear();
    this.onPitch(null);

    if (context && context.state !== "closed") {
      await context.close();
    }
  }

  private listen(): void {
    const audioContext = this.audioContext;
    const analyser = this.analyser;
    if (!audioContext || !analyser) return;

    const frame = new Float32Array(analyser.fftSize);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);

    const update = () => {
      if (this.audioContext !== audioContext) return;

      analyser.getFloatTimeDomainData(frame);
      const rms = calculateRms(frame);

      if (rms >= DEFAULT_PITCH_GATE.minRms) {
        const [frequency, confidence] = detector.findPitch(
          frame,
          audioContext.sampleRate,
        );

        if (
          confidence >= DEFAULT_PITCH_GATE.minConfidence &&
          Number.isFinite(frequency) &&
          frequency > 0
        ) {
          const smoothedFrequency = this.smoother.add(frequency);
          this.onPitch(frequencyToPitch(smoothedFrequency, confidence));
        } else {
          this.onPitch(null);
        }
      } else {
        this.smoother.clear();
        this.onPitch(null);
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    update();
  }
}
