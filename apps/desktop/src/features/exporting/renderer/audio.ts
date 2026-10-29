/**
 * A project's audio, mixed for export as the preview plays it: wherever a piece is on top, every audio track of its
 * recording, summed.
 */
import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from "mediabunny";
import type { AudioGains, AudioLevels, AudioSources } from "#features/editing/domain/audioSettings";
import { type Part, showingOf, toProject, toRecording } from "#media-engine/renderer/timeline";

/** A stretch of an audio file, placed on the project's timeline. */
export interface AudioSpan {
  url: string;
  /** Where it starts on the project's timeline. */
  start: number;
  /** Where it starts in the file. */
  fileStart: number;
  duration: number;
  /** The track's volume and leveling gain together. */
  volume: number;
}

/** Every stretch of audio the project plays. */
export function audioSpans(
  parts: Part[],
  levels: AudioLevels = () => 1,
  gains: AudioGains = () => 1,
  sources: AudioSources = (_recording, _kind, _index, url) => url,
): AudioSpan[] {
  const spans: AudioSpan[] = [];
  const add = (
    url: string,
    start: number,
    fileStart: number,
    duration: number,
    volume: number,
    gain: number,
  ) => {
    if (duration > 1e-6 && volume > 0)
      spans.push({ url, start, fileStart, duration, volume: volume * gain });
  };
  for (const { part, from, to } of showingOf(parts)) {
    const { lead, clips, audio } = part.timeline;
    const [localFrom, localTo] = [toRecording(part, from), toRecording(part, to)];
    for (const clip of clips) {
      const [a, b] = [
        Math.max(localFrom, clip.offset),
        Math.min(localTo, clip.offset + clip.duration),
      ];
      if (b <= a) continue;
      const start = toProject(part, a);
      if (lead === "microphone" || lead === "systemAudio")
        add(
          sources(part.recordingId, lead, 0, clip.url),
          start,
          (clip.fileStart ?? 0) + a - clip.offset,
          b - a,
          levels(part.recordingId, lead, 0),
          gains(part.recordingId, lead, 0),
        );
      // Other tracks follow the leading clip on session time.
      const [sessionFrom, sessionTo] = [clip.start + a - clip.offset, clip.start + b - clip.offset];
      const counts = new Map<string, number>([[lead, 1]]);
      for (const track of audio) {
        const index = counts.get(track.kind) ?? 0;
        counts.set(track.kind, index + 1);
        for (const follower of track.clips) {
          const [x, y] = [
            Math.max(sessionFrom, follower.start),
            Math.min(sessionTo, follower.start + follower.duration),
          ];
          if (y > x)
            add(
              sources(part.recordingId, track.kind, index, follower.url),
              start + x - sessionFrom,
              x - follower.start,
              y - x,
              levels(part.recordingId, track.kind, index),
              gains(part.recordingId, track.kind, index),
            );
        }
      }
    }
  }
  return spans;
}

/** Renders the project's mix a stretch at a time, so a long project isn't held in memory whole. */
export class AudioMix {
  readonly spans: AudioSpan[];
  #sampleRate: number;
  #sinks = new Map<string, Promise<AudioBufferSink | null>>();
  #inputs: Input[] = [];

  constructor(
    parts: Part[],
    sampleRate: number,
    levels?: AudioLevels,
    gains?: AudioGains,
    sources?: AudioSources,
  ) {
    this.spans = audioSpans(parts, levels, gains, sources);
    this.#sampleRate = sampleRate;
  }

  /** The mix from sample `from` to sample `to`, in stereo. */
  async render(from: number, to: number): Promise<AudioBuffer> {
    const rate = this.#sampleRate;
    const context = new OfflineAudioContext(2, to - from, rate);
    const [start, end] = [from / rate, to / rate];
    for (const span of this.spans) {
      const [a, b] = [Math.max(start, span.start), Math.min(end, span.start + span.duration)];
      if (b <= a) continue;
      const sink = await this.#sink(span.url);
      if (!sink) continue;
      const fileFrom = span.fileStart + a - span.start;
      for await (const { buffer, timestamp } of sink.buffers(fileFrom, fileFrom + b - a)) {
        // Where the buffer starts in this stretch; a buffer starting before it is cut in.
        let when = span.start + timestamp - span.fileStart - start;
        let offset = 0;
        if (when < a - start) {
          offset = a - start - when;
          when = a - start;
        }
        const duration = Math.min(buffer.duration - offset, b - start - when);
        if (duration <= 0) continue;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = span.volume;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(when, offset, duration);
      }
    }
    return context.startRendering();
  }

  dispose(): void {
    for (const input of this.#inputs) input.dispose();
  }

  /** Reads the audio file at `url`; null when it has no audio that can be decoded. */
  #sink(url: string): Promise<AudioBufferSink | null> {
    let sink = this.#sinks.get(url);
    if (!sink) {
      const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      this.#inputs.push(input);
      sink = input
        .getPrimaryAudioTrack()
        .then(async (track) =>
          track && (await track.canDecode()) ? new AudioBufferSink(track) : null,
        );
      this.#sinks.set(url, sink);
    }
    return sink;
  }
}
