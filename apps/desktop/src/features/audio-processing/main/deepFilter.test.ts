import assert from "node:assert/strict";
import { test } from "node:test";
import { DeepFilter, erbBands, type Networks } from "./deepFilter.ts";

const BINS = 96;
const TAPS = 5;

/** Networks that report one local SNR, a gain for every band, and the same filter taps for every bin. */
function fixed(lsnr: number, gain: number, taps?: number[]): Networks {
  return {
    async run(frames) {
      const coefs = new Float32Array(frames * BINS * TAPS * 2);
      if (taps)
        for (let i = 0; i < frames * BINS; i++)
          taps.forEach((tap, t) => (coefs[(i * TAPS + t) * 2] = tap));
      return {
        gains: new Float32Array(frames * 32).fill(gain),
        coefs,
        lsnr: new Float32Array(frames).fill(lsnr),
      };
    },
  };
}

function speechLike(length: number): Float32Array {
  let seed = 7;
  return Float32Array.from({ length }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (
      0.3 * Math.sin((2 * Math.PI * 440 * i) / 48000) +
      0.1 * Math.sin((2 * Math.PI * 3100 * i) / 48000) +
      0.05 * (seed / 2147483648 - 0.5)
    );
  });
}

async function run(
  filter: DeepFilter,
  input: Float32Array,
  readSize = 1000,
): Promise<Float32Array> {
  let at = 0;
  const parts: Float32Array[] = [];
  await filter.process(
    async () => {
      if (at >= input.length) return null;
      const chunk = input.slice(at, at + readSize);
      at += readSize;
      return chunk;
    },
    async (samples) => void parts.push(samples),
    input.length,
  );
  const output = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function maxDifference(a: Float32Array, b: Float32Array, scale = 1): number {
  assert.equal(a.length, b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]! * scale));
  return worst;
}

test("the ERB bands cover every bin, at least two each", () => {
  const bands = erbBands();
  assert.equal(bands.length, 32);
  assert.equal(
    bands.reduce((total, count) => total + count, 0),
    481,
  );
  assert.ok(bands.every((count) => count >= 2));
  assert.deepEqual(
    bands,
    bands.toSorted((a, b) => a - b),
    "bands widen with frequency",
  );
});

test("audio the networks call clean comes back unchanged, whatever its length", async () => {
  for (const length of [0, 1, 100, 479, 480, 481, 10_000, 48_123]) {
    const input = speechLike(length);
    const output = await run(new DeepFilter(fixed(100, 1)), input);
    assert.equal(output.length, length);
    assert.ok(
      maxDifference(output, input) < 1e-5,
      `length ${length} differed by ${maxDifference(output, input)}`,
    );
  }
});

test("band gains scale the audio", async () => {
  const input = speechLike(20_000);
  // 25 dB is noisy enough for the gains and too clean for the filter.
  const output = await run(new DeepFilter(fixed(25, 0.5), { maxFilterDb: 20 }), input);
  assert.ok(maxDifference(output, input, 0.5) < 1e-5);
});

test("a filter that passes the middle tap leaves the audio unchanged", async () => {
  const input = speechLike(20_000);
  const output = await run(new DeepFilter(fixed(10, 1, [0, 0, 1, 0, 0])), input);
  assert.ok(maxDifference(output, input) < 1e-5, `differed by ${maxDifference(output, input)}`);
});

test("noise alone is silenced, and the attenuation limit lets some of it back", async () => {
  const input = speechLike(20_000);
  const silent = await run(new DeepFilter(fixed(-40, 1)), input);
  assert.ok(silent.every((sample) => Math.abs(sample) < 1e-6));
  const limited = await run(new DeepFilter(fixed(-40, 1), { attenuationLimit: 20 }), input);
  assert.ok(
    maxDifference(limited, input, 0.1) < 1e-5,
    "20 dB of limit mixes a tenth of the input back",
  );
});

test("the result does not depend on how the input is read or how long the stretches are", async () => {
  const input = speechLike(30_000);
  const networks = fixed(10, 0.7, [0.1, 0.2, 0.5, 0.2, 0.1]);
  const whole = await run(new DeepFilter(networks), input, 48_000);
  const pieces = await run(
    new DeepFilter(networks, { stretch: 7, warmUp: 5, after: 3 }),
    input,
    333,
  );
  assert.ok(maxDifference(whole, pieces) < 1e-6, `differed by ${maxDifference(whole, pieces)}`);
});

test("each stretch gets the frames before and after it that it was promised", async () => {
  const seen: number[] = [];
  const spy: Networks = {
    async run(frames, erb, spec) {
      seen.push(frames);
      return fixed(100, 1).run(frames, erb, spec);
    },
  };
  await run(
    new DeepFilter(spy, { stretch: 100, warmUp: 30, after: 8 }),
    speechLike(100 * 480 * 5 + 5),
  );
  // The first stretch has nothing before it, and the last ends where the signal does.
  assert.equal(seen[0], 100 + 8);
  assert.deepEqual(seen.slice(1, 4), [138, 138, 138], `stretches of ${seen}`);
  assert.ok(seen.every((frames) => frames <= 30 + 100 + 8));
});
