/** Reads a video file's frames for an export, which asks for them in time order. */
import { ALL_FORMATS, Input, UrlSource, type VideoSample, VideoSampleSink } from "mediabunny";

/** Times this close are the same frame, in seconds. */
const SAME = 1e-4;
/** How far ahead of the next frame a request may be before decoding starts again from there, in seconds. */
const JUMP = 2;

export class FrameReader {
  #input: Input;
  #sink: Promise<VideoSampleSink | null>;
  #samples?: AsyncGenerator<VideoSample, void, unknown>;
  #current: VideoSample | null = null;
  #next: VideoSample | null = null;

  constructor(url: string) {
    this.#input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    this.#sink = this.#input
      .getPrimaryVideoTrack()
      .then((track) => (track ? new VideoSampleSink(track) : null));
  }

  /**
   * The frame showing at `time` in the file: the last that starts by then, or the first. Null when the file has no
   * video. It's the reader's: it stays open until the reader moves past it.
   */
  async at(time: number): Promise<VideoSample | null> {
    const current = this.#current;
    const next = this.#next;
    if (
      !this.#samples ||
      (current && time < current.timestamp - SAME) ||
      (next && time > next.timestamp + JUMP)
    ) {
      await this.#restart(time);
    }
    while (this.#next && this.#next.timestamp <= time + SAME) {
      this.#current?.close();
      this.#current = this.#next;
      this.#next = await this.#read();
    }
    return this.#current;
  }

  async close(): Promise<void> {
    await this.#stop();
    this.#input.dispose();
  }

  async #restart(time: number): Promise<void> {
    await this.#stop();
    const sink = await this.#sink;
    if (!sink) return;
    this.#samples = sink.samples(time);
    this.#current = await this.#read();
    this.#next = await this.#read();
  }

  async #read(): Promise<VideoSample | null> {
    const result = await this.#samples?.next();
    return result && !result.done ? result.value : null;
  }

  async #stop(): Promise<void> {
    this.#current?.close();
    this.#next?.close();
    this.#current = this.#next = null;
    await this.#samples?.return();
    this.#samples = undefined;
  }
}
