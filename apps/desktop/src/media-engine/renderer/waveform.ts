/** Peak amplitude at 100 intervals per second, shared by every visible piece of a recording. */
export interface Waveform {
  peaks: Float32Array;
  secondsPerPeak: number;
}

/** Keeps brief transients and either stereo channel visible without cancelling opposite-phase samples. */
export function audioPeaks(channels: Float32Array[], sampleRate: number): Waveform {
  const framesPerPeak = Math.max(1, Math.round(sampleRate / 100));
  const length = channels[0]?.length ?? 0;
  const peaks = new Float32Array(Math.ceil(length / framesPerPeak));
  for (const channel of channels) {
    for (let frame = 0; frame < channel.length; frame++) {
      const index = Math.floor(frame / framesPerPeak);
      peaks[index] = Math.max(peaks[index]!, Math.min(1, Math.abs(channel[frame]!)));
    }
  }
  return { peaks, secondsPerPeak: framesPerPeak / sampleRate };
}

/** A smooth, filled amplitude envelope, limited to the visible part of the source audio. */
export function waveformPath(
  waveform: Waveform,
  sourceStart: number,
  duration: number,
  width: number,
  from: number,
  to: number,
): string {
  if (width <= 0 || duration <= 0 || to <= from) return "";
  const { peaks, secondsPerPeak } = waveform;
  const points: { x: number; height: number }[] = [];
  // Keep one point beyond each visible edge so scrolling doesn't change the curve at the viewport boundary.
  const firstCell = Math.max(0, Math.floor(from / 3) - 1);
  const lastCell = Math.min(Math.ceil(width / 3) - 1, Math.ceil(to / 3));
  for (let cell = firstCell; cell <= lastCell; cell++) {
    const x = cell * 3;
    const end = Math.min(x + 3, width);
    const first = Math.max(0, Math.floor((sourceStart + (x / width) * duration) / secondsPerPeak));
    const last = Math.min(
      peaks.length,
      Math.ceil((sourceStart + (end / width) * duration) / secondsPerPeak),
    );
    let peak = 0;
    for (let i = first; i < last; i++) peak = Math.max(peak, peaks[i]!);
    // Fixed square-root scaling makes quiet speech legible while keeping silence flat and levels comparable.
    const height = Math.sqrt(peak) * 10;
    if (cell === 0) points.push({ x: -from, height });
    points.push({ x: (x + end) / 2 - from, height });
    if (end === width) points.push({ x: width - from, height });
  }
  if (!points.some((point) => point.height > 0)) return "";

  const number = (value: number) => value.toFixed(2);
  const edge = (side: number, reverse = false) => {
    const ordered = reverse ? [...points].reverse() : points;
    return ordered
      .map((point, index) => {
        const y = 12 + side * point.height;
        if (index === 0) return `${reverse ? "L" : "M"}${number(point.x)},${number(y)}`;
        const previous = ordered[index - 1]!;
        const middle = number((previous.x + point.x) / 2);
        // Horizontal tangents join each peak smoothly without overshooting into silence or outside the track.
        return `C${middle},${number(12 + side * previous.height)} ${middle},${number(y)} ${number(point.x)},${number(y)}`;
      })
      .join("");
  };
  return `${edge(-1)}${edge(1, true)}Z`;
}

/** Project-scoped cache. Decode one file at a time and retain only compact peaks, never decoded audio. */
export class WaveformCache {
  #files = new Map<string, Promise<Waveform | null>>();
  #pending: Promise<unknown> = Promise.resolve();
  #abort = new AbortController();

  get(url: string): Promise<Waveform | null> {
    const cached = this.#files.get(url);
    if (cached) return cached;
    const result = this.#pending.then(async () => {
      if (this.#abort.signal.aborted) return null;
      try {
        const response = await fetch(url, { signal: this.#abort.signal });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        if (this.#abort.signal.aborted) return null;
        const audio = await new OfflineAudioContext(1, 1, 24_000).decodeAudioData(bytes);
        if (this.#abort.signal.aborted) return null;
        return audioPeaks(
          Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)),
          audio.sampleRate,
        );
      } catch {
        // Unreadable audio still keeps its filename and can be played if the media element supports it.
        return null;
      }
    });
    this.#files.set(url, result);
    this.#pending = result;
    return result;
  }

  dispose(): void {
    this.#abort.abort();
    this.#files.clear();
  }
}
