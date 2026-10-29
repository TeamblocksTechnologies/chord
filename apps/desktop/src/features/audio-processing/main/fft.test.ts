import assert from "node:assert/strict";
import { test } from "node:test";
import { Fft } from "./fft.ts";

function dft(re: number[], im: number[], inverse: boolean): { re: number[]; im: number[] } {
  const n = re.length;
  const sign = inverse ? 1 : -1;
  const out = { re: new Array<number>(n).fill(0), im: new Array<number>(n).fill(0) };
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (sign * 2 * Math.PI * k * t) / n;
      out.re[k] += re[t]! * Math.cos(angle) - im[t]! * Math.sin(angle);
      out.im[k] += re[t]! * Math.sin(angle) + im[t]! * Math.cos(angle);
    }
  }
  return out;
}

function noise(length: number, seed: number): number[] {
  let state = seed;
  return Array.from(
    { length },
    () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5,
  );
}

for (const size of [1, 2, 3, 5, 15, 30, 64, 960]) {
  test(`a ${size}-point transform matches the direct sum, forward and inverse`, () => {
    const [re, im] = [noise(size, 1), noise(size, 2)];
    const fft = new Fft(size);
    for (const inverse of [false, true]) {
      const [a, b] = [Float64Array.from(re), Float64Array.from(im)];
      if (inverse) fft.inverse(a, b);
      else fft.forward(a, b);
      const expected = dft(re, im, inverse);
      for (let i = 0; i < size; i++) {
        assert.ok(
          Math.abs(a[i]! - expected.re[i]!) < 1e-9 && Math.abs(b[i]! - expected.im[i]!) < 1e-9,
          `bin ${i} of ${inverse ? "inverse" : "forward"}`,
        );
      }
    }
  });
}

test("the inverse undoes the forward transform once divided by the size", () => {
  const fft = new Fft(960);
  const [re, im] = [Float64Array.from(noise(960, 3)), Float64Array.from(noise(960, 4))];
  const [a, b] = [Float64Array.from(re), Float64Array.from(im)];
  fft.forward(a, b);
  fft.inverse(a, b);
  for (let i = 0; i < 960; i++)
    assert.ok(Math.abs(a[i]! / 960 - re[i]!) < 1e-12 && Math.abs(b[i]! / 960 - im[i]!) < 1e-12);
});

test("sizes with other prime factors are refused", () => {
  assert.throws(() => new Fft(7), /factors other than 2, 3 and 5/);
  assert.throws(() => new Fft(0));
});
