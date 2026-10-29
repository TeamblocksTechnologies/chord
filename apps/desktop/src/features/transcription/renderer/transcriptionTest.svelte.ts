import type { TranscriptionModelId } from "../domain/transcription.ts";

/** A test recording stops by itself after this long. */
const MAX_SECONDS = 30;
/** What the models transcribe at; the recording is resampled to it. */
const SAMPLE_RATE = 16_000;
/** Below this, the meter reads empty. */
const FLOOR_DB = -60;

/**
 * Records the default microphone until `stop`, then transcribes it with a model, to try the model out. The
 * microphone is the system's, not the recorder helper's, since this is about the model rather than the recording.
 */
export class TranscriptionTest {
  phase = $state<"idle" | "recording" | "transcribing">("idle");
  /** The input level while recording, 0...1. */
  level = $state(0);
  /** The last test's transcript, or why there's none, with the model it was for. */
  result = $state<
    ({ model: TranscriptionModelId } & ({ text: string } | { error: string })) | null
  >(null);

  #stop: (() => void) | null = null;
  #disposed = false;

  async start(model: TranscriptionModelId): Promise<void> {
    if (this.phase !== "idle") return;
    this.result = null;
    this.phase = "recording";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.phase = "idle";
      this.result = { model, error: "Couldn't use the microphone" };
      return;
    }
    if (this.#disposed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const wave = new Float32Array(analyser.fftSize);
    let frame = 0;
    const meter = () => {
      analyser.getFloatTimeDomainData(wave);
      const rms = Math.sqrt(wave.reduce((sum, sample) => sum + sample * sample, 0) / wave.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      this.level = Math.min(1, Math.max(0, 1 - db / FLOOR_DB));
      frame = requestAnimationFrame(meter);
    };
    meter();

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    this.#stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    const timeout = setTimeout(() => this.stop(), MAX_SECONDS * 1000);
    recorder.start();
    await stopped;

    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    this.#stop = null;
    this.level = 0;
    if (this.#disposed) return;

    this.phase = "transcribing";
    try {
      const recording = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(recording);
      const text = await window.chord.desktop.models.transcribe(
        model,
        audio.getChannelData(0),
        audio.sampleRate,
      );
      this.result = { model, text };
    } catch (error) {
      this.result = {
        model,
        error: error instanceof Error ? error.message : "Couldn't transcribe",
      };
    }
    this.phase = "idle";
  }

  /** Ends the recording and transcribes it. */
  stop(): void {
    this.#stop?.();
  }

  /** Ends the recording without transcribing it, e.g. when Settings closes. */
  dispose(): void {
    this.#disposed = true;
    this.#stop?.();
  }
}
