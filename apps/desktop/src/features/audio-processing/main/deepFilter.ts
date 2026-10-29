/**
 * DeepFilterNet3 noise reduction for one channel of 48 kHz audio: the transform, features and filtering around its
 * three networks, ported from the MIT/Apache-2.0 reference at github.com/Rikorose/DeepFilterNet (libDF). The networks
 * themselves are behind `Networks`, so this file holds only signal processing.
 *
 * The reference streams one 10 ms frame at a time; this runs the same steps over whole stretches of frames, which
 * gives the same result because the networks' only memory is inside them and is rebuilt from the context each stretch
 * is given.
 */
import { Fft } from "./fft.ts";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 960;
const HOP = 480;
const BINS = FFT_SIZE / 2 + 1;
const ERB_BANDS = 32;
const MIN_ERB_BINS = 2;
/** The bins the deep filter handles, from the bottom. */
const DF_BINS = 96;
const DF_ORDER = 5;
/** How many frames ahead the networks and the filter look. */
const LOOKAHEAD = 2;
/** Smoothing of the running normalization, from a time constant of 1 s at 100 frames a second. */
const ALPHA = 0.99;

/** The samples the output trails the model's input by before it's shifted back: the transform's and the lookahead's. */
export const DEEP_FILTER_DELAY = FFT_SIZE - HOP + LOOKAHEAD * HOP;
export const DEEP_FILTER_RATE = SAMPLE_RATE;

/** What the three networks make of a stretch of `frames` frames of features. */
export interface NetworkOutput {
  /** Per frame and ERB band, `frames * 32`: the gain to apply. */
  gains: Float32Array;
  /** Per frame, bin and filter tap, a real and an imaginary part: `frames * 96 * 5 * 2`. */
  coefs: Float32Array;
  /** Per frame, the estimated local signal to noise ratio in dB. */
  lsnr: Float32Array;
}

export interface Networks {
  /**
   * `erb` is `frames * 32` normalized band energies; `spec` is `2 * frames * 96`, the real parts of the lowest bins
   * for every frame and then the imaginary parts. The networks pad their ends with zeros.
   */
  run(frames: number, erb: Float32Array, spec: Float32Array): Promise<NetworkOutput>;
}

export interface DeepFilterOptions {
  /** The most the noise is reduced, in dB; undefined for no limit. */
  attenuationLimit?: number;
  /** Below this local SNR a frame is taken for noise alone and silenced. */
  minDb?: number;
  /** Above these a frame is clean enough to skip the band gains, and then the deep filter. */
  maxGainsDb?: number;
  maxFilterDb?: number;
  /** Frames the networks run on at once, the frames before them that warm their memory up, and the ones after. */
  stretch?: number;
  warmUp?: number;
  after?: number;
}

const DEFAULTS = {
  minDb: -15,
  maxGainsDb: 35,
  maxFilterDb: 35,
  stretch: 1000,
  warmUp: 300,
  after: 8,
};

/** The frequency bins in each ERB band. */
export function erbBands(): number[] {
  const toErb = (hz: number) => Math.fround(9.265 * Math.log1p(hz / (24.7 * 9.265)));
  const toHz = (erb: number) => Math.fround(24.7 * 9.265 * (Math.exp(erb / 9.265) - 1));
  const binWidth = SAMPLE_RATE / FFT_SIZE;
  const low = toErb(0);
  const step = Math.fround((toErb(SAMPLE_RATE / 2) - low) / ERB_BANDS);
  const bands = new Array<number>(ERB_BANDS).fill(0);
  let previous = 0;
  let over = 0;
  for (let i = 1; i <= ERB_BANDS; i++) {
    const bin = Math.round(Math.fround(toHz(Math.fround(low + i * step)) / binWidth));
    let count = bin - previous - over;
    if (count < MIN_ERB_BINS) {
      over = MIN_ERB_BINS - count;
      count = MIN_ERB_BINS;
    } else {
      over = 0;
    }
    bands[i - 1] = count;
    previous = bin;
  }
  bands[ERB_BANDS - 1]! += 1;
  const tooLarge = bands.reduce((total, count) => total + count, 0) - BINS;
  if (tooLarge > 0) bands[ERB_BANDS - 1]! -= tooLarge;
  return bands;
}

/** One frame: the noisy spectrum and the features made from it. */
interface Frame {
  re: Float32Array;
  im: Float32Array;
  erb: Float32Array;
  spec: Float32Array;
}

/** Turns a signal into frames of spectrum and features, and enhanced spectra back into a signal. */
class Transform {
  readonly #fft = new Fft(FFT_SIZE);
  readonly #window = Float64Array.from({ length: FFT_SIZE }, (_, i) => {
    const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / (FFT_SIZE / 2));
    return Math.sin(0.5 * Math.PI * s * s);
  });
  readonly #bands = erbBands();
  readonly #re = new Float64Array(FFT_SIZE);
  readonly #im = new Float64Array(FFT_SIZE);
  #previous = new Float64Array(HOP);
  #overlap = new Float64Array(HOP);
  readonly #meanState = Float64Array.from(
    { length: ERB_BANDS },
    (_, i) => -60 + (i * (-90 - -60)) / (ERB_BANDS - 1),
  );
  readonly #unitState = Float64Array.from(
    { length: DF_BINS },
    (_, i) => 0.001 + (i * (0.0001 - 0.001)) / (DF_BINS - 1),
  );

  /** The next frame of the signal: `block` is its 480 new samples. */
  analyse(block: Float32Array): Frame {
    const [re, im, window] = [this.#re, this.#im, this.#window];
    for (let i = 0; i < HOP; i++) {
      re[i] = this.#previous[i]! * window[i]!;
      re[HOP + i] = block[i]! * window[HOP + i]!;
    }
    im.fill(0);
    for (let i = 0; i < HOP; i++) this.#previous[i] = block[i]!;
    this.#fft.forward(re, im);
    const frame: Frame = {
      re: new Float32Array(BINS),
      im: new Float32Array(BINS),
      erb: new Float32Array(ERB_BANDS),
      spec: new Float32Array(2 * DF_BINS),
    };
    const norm = 1 / FFT_SIZE;
    for (let k = 0; k < BINS; k++) {
      frame.re[k] = re[k]! * norm;
      frame.im[k] = im[k]! * norm;
    }
    // ERB features: the mean power of each band in dB, with a running mean taken off.
    let bin = 0;
    for (let band = 0; band < ERB_BANDS; band++) {
      const size = this.#bands[band]!;
      let power = 0;
      for (let j = 0; j < size; j++, bin++)
        power += (frame.re[bin]! ** 2 + frame.im[bin]! ** 2) / size;
      const db = Math.log10(power + 1e-10) * 10;
      this.#meanState[band] = db * (1 - ALPHA) + this.#meanState[band]! * ALPHA;
      frame.erb[band] = (db - this.#meanState[band]!) / 40;
    }
    // Complex features: the lowest bins, each divided by the root of its running magnitude.
    for (let k = 0; k < DF_BINS; k++) {
      this.#unitState[k] =
        Math.hypot(frame.re[k]!, frame.im[k]!) * (1 - ALPHA) + this.#unitState[k]! * ALPHA;
      const scale = 1 / Math.sqrt(this.#unitState[k]!);
      frame.spec[k] = frame.re[k]! * scale;
      frame.spec[DF_BINS + k] = frame.im[k]! * scale;
    }
    return frame;
  }

  /** The next 480 samples of the signal from the next frame's spectrum, overlapping the last. */
  synthesise(spectrumRe: Float64Array, spectrumIm: Float64Array, out: Float32Array): void {
    const [re, im, window] = [this.#re, this.#im, this.#window];
    for (let k = 0; k < BINS; k++) {
      re[k] = spectrumRe[k]!;
      im[k] = k === 0 || k === BINS - 1 ? 0 : spectrumIm[k]!;
    }
    for (let k = BINS; k < FFT_SIZE; k++) {
      re[k] = re[FFT_SIZE - k]!;
      im[k] = -im[FFT_SIZE - k]!;
    }
    this.#fft.inverse(re, im);
    for (let i = 0; i < HOP; i++) {
      out[i] = re[i]! * window[i]! + this.#overlap[i]!;
      this.#overlap[i] = re[HOP + i]! * window[HOP + i]!;
    }
  }
}

/** Reduces the noise in audio a channel at a time. */
export class DeepFilter {
  readonly #networks: Networks;
  readonly #options: typeof DEFAULTS & Pick<DeepFilterOptions, "attenuationLimit">;
  readonly #bands = erbBands();

  constructor(networks: Networks, options: DeepFilterOptions = {}) {
    this.#networks = networks;
    this.#options = { ...DEFAULTS, ...definedOnly(options) };
  }

  /**
   * Reads one channel of `total` samples with `read`, which returns null at its end, and hands the same number of
   * samples, aligned with the input, to `write`. `progress` is told the fraction of the input read.
   */
  async process(
    read: () => Promise<Float32Array | null>,
    write: (samples: Float32Array) => Promise<void>,
    total: number,
    progress?: (fraction: number) => void,
  ): Promise<void> {
    const { stretch, warmUp, after } = this.#options;
    const analysis = new Transform();
    const synthesis = new Transform();
    // Output sample s is in frame floor(s / hop) + 1's synthesis, so frames up to ceil(total / hop) are enhanced; the
    // networks and the filter look a few frames past the last of those, which are silence.
    const enhanced = Math.ceil(total / HOP) + 1;
    const needed = enhanced + LOOKAHEAD + 1;
    const frames: Frame[] = [];
    /** The frame number of `frames[0]`. */
    let first = 0;
    let pending: Float32Array = new Float32Array(0);
    let ended = false;
    let consumed = 0;

    const analyse = async (until: number) => {
      const block = new Float32Array(HOP);
      while (first + frames.length < Math.min(until, needed)) {
        while (pending.length < HOP && !ended) {
          const chunk = await read();
          if (chunk) pending = concat([pending, chunk], pending.length + chunk.length);
          else ended = true;
        }
        const taken = Math.min(HOP, pending.length);
        block.fill(0);
        block.set(pending.subarray(0, taken));
        pending = pending.subarray(taken);
        consumed += taken;
        frames.push(analysis.analyse(block));
      }
    };

    const spectrumRe = new Float64Array(BINS);
    const spectrumIm = new Float64Array(BINS);
    const chunk = new Float32Array(HOP);
    let remaining = total;
    for (let next = 0; next < enhanced;) {
      const count = Math.min(stretch, enhanced - next);
      await analyse(next + count + after);
      const from = Math.max(0, next - warmUp);
      const to = Math.min(first + frames.length, next + count + after);
      const length = to - from;
      const erb = new Float32Array(length * ERB_BANDS);
      const spec = new Float32Array(2 * length * DF_BINS);
      for (let i = 0; i < length; i++) {
        const frame = frames[from - first + i]!;
        erb.set(frame.erb, i * ERB_BANDS);
        spec.set(frame.spec.subarray(0, DF_BINS), i * DF_BINS);
        spec.set(frame.spec.subarray(DF_BINS), (length + i) * DF_BINS);
      }
      const result = await this.#networks.run(length, erb, spec);
      for (let k = next; k < next + count; k++) {
        // The networks' output for a frame comes out the lookahead later: their last convolutions look ahead and the
        // exported graphs keep no delay of their own, unlike the reference's streaming ones.
        this.#enhance(frames, first, k, k - from + LOOKAHEAD, result, spectrumRe, spectrumIm);
        synthesis.synthesise(spectrumRe, spectrumIm, chunk);
        // Frame k's synthesis ends at sample k * hop; frame 0's is before the signal begins.
        if (k >= 1 && remaining > 0) {
          const part = chunk.slice(0, Math.min(HOP, remaining));
          remaining -= part.length;
          await write(part);
        }
      }
      next += count;
      // Frames well behind the next one are no longer needed for the warm-up or the filter.
      const drop = next - Math.max(warmUp, DF_ORDER) - first;
      if (drop > 0) {
        frames.splice(0, drop);
        first += drop;
      }
      progress?.(Math.min(1, consumed / Math.max(1, total)));
    }
    if (remaining !== 0) throw new Error(`Noise reduction was ${remaining} samples short`);
  }

  /** The enhanced spectrum of frame `k` into `outRe` and `outIm`. `at` is the frame of the networks' output made for it. */
  #enhance(
    frames: Frame[],
    first: number,
    k: number,
    at: number,
    result: NetworkOutput,
    outRe: Float64Array,
    outIm: Float64Array,
  ): void {
    const { minDb, maxGainsDb, maxFilterDb, attenuationLimit } = this.#options;
    const frame = frames[k - first]!;
    const lsnr = result.lsnr[at]!;
    // Noise alone is silenced; clean speech is left alone; in between the band gains apply, and unless the speech is
    // nearly clean, the deep filter as well.
    const [silence, gains, filter] =
      lsnr < minDb
        ? [true, false, false]
        : lsnr > maxGainsDb
          ? [false, false, false]
          : lsnr > maxFilterDb
            ? [false, true, false]
            : [false, true, true];
    for (let bin = 0; bin < BINS; bin++) {
      outRe[bin] = frame.re[bin]!;
      outIm[bin] = frame.im[bin]!;
    }
    if (silence) {
      outRe.fill(0);
      outIm.fill(0);
    } else if (gains) {
      let bin = 0;
      for (let band = 0; band < ERB_BANDS; band++) {
        const gain = result.gains[at * ERB_BANDS + band]!;
        for (let j = 0; j < this.#bands[band]!; j++, bin++) {
          outRe[bin]! *= gain;
          outIm[bin]! *= gain;
        }
      }
    }
    if (filter) {
      // The lowest bins are rebuilt from the noisy frames around this one, each scaled by a complex tap.
      for (let bin = 0; bin < DF_BINS; bin++) {
        let sumRe = 0;
        let sumIm = 0;
        for (let tap = 0; tap < DF_ORDER; tap++) {
          const source = frames[k - LOOKAHEAD + tap - first];
          if (!source) continue;
          const index = ((at * DF_BINS + bin) * DF_ORDER + tap) * 2;
          const [cRe, cIm] = [result.coefs[index]!, result.coefs[index + 1]!];
          sumRe += source.re[bin]! * cRe - source.im[bin]! * cIm;
          sumIm += source.re[bin]! * cIm + source.im[bin]! * cRe;
        }
        outRe[bin] = sumRe;
        outIm[bin] = sumIm;
      }
    }
    if (attenuationLimit !== undefined) {
      const mix = 10 ** (-Math.abs(attenuationLimit) / 20);
      for (let bin = 0; bin < BINS; bin++) {
        outRe[bin] = outRe[bin]! * (1 - mix) + frame.re[bin]! * mix;
        outIm[bin] = outIm[bin]! * (1 - mix) + frame.im[bin]! * mix;
      }
    }
  }
}

function definedOnly<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function concat(parts: Float32Array[], length: number): Float32Array {
  const joined = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}
