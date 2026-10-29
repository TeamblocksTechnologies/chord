/**
 * A complex FFT for any length whose factors are 2, 3 and 5, such as the 960 points the noise reduction model uses.
 * Mixed-radix decimation in time over precomputed twiddles; plain and short rather than the fastest possible.
 */
export class Fft {
  readonly size: number;
  readonly #factors: number[];
  readonly #cos: Float64Array;
  readonly #sin: Float64Array;
  readonly #scratchRe: Float64Array;
  readonly #scratchIm: Float64Array;
  /** The twiddled sub-transform outputs of one level's combine step, a pair per level. */
  readonly #levels: { re: Float64Array; im: Float64Array }[];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error("FFT size must be a positive integer");
    this.size = size;
    this.#factors = factorize(size);
    this.#cos = new Float64Array(size);
    this.#sin = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      this.#cos[k] = Math.cos((2 * Math.PI * k) / size);
      this.#sin[k] = -Math.sin((2 * Math.PI * k) / size);
    }
    this.#scratchRe = new Float64Array(size);
    this.#scratchIm = new Float64Array(size);
    this.#levels = this.#factors.map((p) => ({ re: new Float64Array(p), im: new Float64Array(p) }));
  }

  /** The forward transform of `re` and `im`, in place. */
  forward(re: Float64Array, im: Float64Array): void {
    this.#transform(re, im, false);
  }

  /** The inverse transform of `re` and `im`, in place, without dividing by the size. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.#transform(re, im, true);
  }

  #transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    if (re.length !== this.size || im.length !== this.size)
      throw new Error("FFT input has the wrong length");
    // The inverse is the forward transform with the roles of the real and imaginary parts swapped.
    const [a, b] = inverse ? [im, re] : [re, im];
    this.#recurse(a, b, 0, 1, this.#scratchRe, this.#scratchIm, 0, this.size, 0);
    a.set(this.#scratchRe);
    b.set(this.#scratchIm);
  }

  /** Writes the transform of the `n` points of `in` starting at `offset` with step `stride` to `out` from `at`. */
  #recurse(
    inRe: Float64Array,
    inIm: Float64Array,
    offset: number,
    stride: number,
    outRe: Float64Array,
    outIm: Float64Array,
    at: number,
    n: number,
    level: number,
  ): void {
    if (n === 1) {
      outRe[at] = inRe[offset]!;
      outIm[at] = inIm[offset]!;
      return;
    }
    const p = this.#factors[level]!;
    const m = n / p;
    for (let r = 0; r < p; r++)
      this.#recurse(
        inRe,
        inIm,
        offset + r * stride,
        stride * p,
        outRe,
        outIm,
        at + r * m,
        m,
        level + 1,
      );
    const step = this.size / n;
    const { re: yRe, im: yIm } = this.#levels[level]!;
    for (let k = 0; k < m; k++) {
      // Twiddle the p sub-transforms' k-th outputs, then take a p-point DFT of them.
      for (let r = 0; r < p; r++) {
        const index = (r * k * step) % this.size;
        const c = this.#cos[index]!,
          s = this.#sin[index]!;
        const xr = outRe[at + r * m + k]!,
          xi = outIm[at + r * m + k]!;
        yRe[r] = xr * c - xi * s;
        yIm[r] = xr * s + xi * c;
      }
      for (let q = 0; q < p; q++) {
        let sumRe = 0,
          sumIm = 0;
        for (let r = 0; r < p; r++) {
          const index = ((r * q * m) % n) * step;
          const c = this.#cos[index]!,
            s = this.#sin[index]!;
          sumRe += yRe[r]! * c - yIm[r]! * s;
          sumIm += yRe[r]! * s + yIm[r]! * c;
        }
        outRe[at + q * m + k] = sumRe;
        outIm[at + q * m + k] = sumIm;
      }
    }
  }
}

function factorize(size: number): number[] {
  const factors: number[] = [];
  let rest = size;
  for (const p of [4, 2, 3, 5]) {
    while (rest % p === 0) {
      factors.push(p);
      rest /= p;
    }
  }
  if (rest !== 1) throw new Error(`FFT size ${size} has factors other than 2, 3 and 5`);
  return factors;
}
