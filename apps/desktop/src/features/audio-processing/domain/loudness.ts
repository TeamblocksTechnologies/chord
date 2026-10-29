/**
 * Loudness for voice leveling: ITU-R BS.1770 integrated loudness (K-weighted, gated), and the one gain that brings a
 * take to the leveling target without its peaks passing the ceiling.
 */

/** Where leveled audio aims, in LUFS. */
export const LEVEL_TARGET = -16;
/** The highest a leveled take's sample peaks may reach, in dBFS. */
export const LEVEL_CEILING = -1;
/** The most a take is ever raised, so a take of room noise isn't blown up. */
export const LEVEL_MAX_BOOST = 24;

const BLOCK_SECONDS = 0.1;
const BLOCKS_PER_WINDOW = 4;

interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

/** The K-weighting filters for `rate`: a high shelf, then a high pass. */
function kWeighting(rate: number): Biquad[] {
  let k = Math.tan((Math.PI * 1681.974450955533) / rate);
  let q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b: [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
    ],
    a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
  k = Math.tan((Math.PI * 38.13547087602444) / rate);
  q = 0.5003270373238773;
  a0 = 1 + k / q + k * k;
  return [shelf, { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] }];
}

interface Channel {
  /** Each filter's last two inputs and outputs. */
  memory: number[][];
  /** Energy of the 100 ms block being filled, and how many frames are in it. */
  energy: number;
  frames: number;
  /** The energy of every finished block. */
  blocks: number[];
}

/** Measures audio handed over in order, a stretch at a time, so a long take isn't held in memory. */
export class LoudnessMeter {
  /** The largest sample magnitude seen. */
  peak = 0;
  readonly #filters: Biquad[];
  readonly #blockFrames: number;
  readonly #channels: Channel[];

  constructor(rate: number, channels: number) {
    this.#filters = kWeighting(rate);
    this.#blockFrames = Math.max(1, Math.round(rate * BLOCK_SECONDS));
    this.#channels = Array.from({ length: channels }, () => ({
      memory: this.#filters.map(() => [0, 0, 0, 0]),
      energy: 0,
      frames: 0,
      blocks: [],
    }));
  }

  /** Adds the next frames, one array per channel, continuing from the last call. */
  add(samples: Float32Array[]): void {
    this.#channels.forEach((channel, index) => {
      const input = samples[index];
      if (!input) return;
      for (let i = 0; i < input.length; i++) {
        let value = input[i]!;
        const magnitude = Math.abs(value);
        if (magnitude > this.peak) this.peak = magnitude;
        this.#filters.forEach(({ b, a }, stage) => {
          const m = channel.memory[stage]!;
          // Direct form I; m holds the last two inputs, then the last two outputs.
          const out = b[0] * value + b[1] * m[0]! + b[2] * m[1]! - a[0] * m[2]! - a[1] * m[3]!;
          m[1] = m[0]!;
          m[0] = value;
          m[3] = m[2]!;
          m[2] = out;
          value = out;
        });
        channel.energy += value * value;
        if (++channel.frames === this.#blockFrames) {
          channel.blocks.push(channel.energy);
          channel.energy = 0;
          channel.frames = 0;
        }
      }
    });
  }

  /** The mean square of each 400 ms window, every 100 ms, summed over channels. */
  windows(): number[] {
    const count = Math.min(...this.#channels.map((channel) => channel.blocks.length));
    const windows: number[] = [];
    const size = this.#blockFrames * BLOCKS_PER_WINDOW;
    for (let start = 0; start + BLOCKS_PER_WINDOW <= count; start++) {
      let sum = 0;
      for (const { blocks } of this.#channels)
        for (let i = 0; i < BLOCKS_PER_WINDOW; i++) sum += blocks[start + i]!;
      windows.push(sum / size);
    }
    return windows;
  }
}

/** Integrated loudness in LUFS of windows from `LoudnessMeter.windows`; null when nothing is above the gates. */
export function integratedLoudness(windows: number[]): number | null {
  const loudness = (power: number) => -0.691 + 10 * Math.log10(power);
  const mean = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const audible = windows.filter((power) => power > 0 && loudness(power) > -70);
  if (audible.length === 0) return null;
  const threshold = loudness(mean(audible)) - 10;
  const kept = audible.filter((power) => loudness(power) > threshold);
  return kept.length > 0 ? loudness(mean(kept)) : null;
}

/**
 * The linear gain that brings a take measuring `loudness` LUFS with sample peak `peak` to the target, limited so its
 * peaks stay under the ceiling. Null when there's nothing to level: silence, or nothing measurable.
 */
export function levelGain(loudness: number | null, peak: number): number | null {
  if (loudness === null || !Number.isFinite(loudness) || !(peak > 0)) return null;
  const wanted = 10 ** (Math.min(LEVEL_TARGET - loudness, LEVEL_MAX_BOOST) / 20);
  const room = 10 ** (LEVEL_CEILING / 20) / peak;
  return Math.min(wanted, room);
}
