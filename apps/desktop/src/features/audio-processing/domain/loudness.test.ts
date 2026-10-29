import assert from "node:assert/strict";
import { test } from "node:test";
import {
  integratedLoudness,
  LEVEL_CEILING,
  LEVEL_MAX_BOOST,
  LEVEL_TARGET,
  levelGain,
  LoudnessMeter,
} from "./loudness.ts";

const RATE = 48_000;

function sine(seconds: number, amplitude: number, frequency = 1000): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE),
  );
}

function measure(
  channels: Float32Array[],
  chunk = 4800,
): { loudness: number | null; peak: number } {
  const meter = new LoudnessMeter(RATE, channels.length);
  for (let at = 0; at < channels[0]!.length; at += chunk)
    meter.add(channels.map((channel) => channel.subarray(at, at + chunk)));
  return { loudness: integratedLoudness(meter.windows()), peak: meter.peak };
}

test("a full-scale-referenced sine reads as the BS.1770 reference level", () => {
  // BS.1770 calibration: a full-scale 997 Hz sine in one channel reads -3.01 LUFS; 1 kHz is within a hundredth of a dB.
  const { loudness } = measure([sine(5, 1)]);
  assert.ok(Math.abs(loudness! - -3.01) < 0.1, `read ${loudness}`);
});

test("loudness does not depend on how the audio is chunked", () => {
  const signal = sine(3, 0.1, 300);
  assert.equal(measure([signal], 4800).loudness, measure([signal], 777).loudness);
});

test("silence between speech is gated out of the measurement", () => {
  const speech = sine(3, 0.1);
  const mixed = new Float32Array(speech.length * 3);
  mixed.set(speech, speech.length);
  const alone = measure([speech]).loudness!;
  assert.ok(
    Math.abs(measure([mixed]).loudness! - alone) < 0.5,
    `read ${measure([mixed]).loudness}, expected ${alone}`,
  );
});

test("silence and takes shorter than a window have nothing to level", () => {
  assert.equal(measure([new Float32Array(RATE * 2)]).loudness, null);
  assert.equal(levelGain(null, 0), null);
  assert.equal(measure([sine(0.2, 0.5)]).loudness, null);
  assert.equal(levelGain(-20, 0), null);
});

test("quiet takes are raised to the target and loud ones lowered", () => {
  const quiet = measure([sine(4, 0.02)]);
  const gain = levelGain(quiet.loudness, quiet.peak)!;
  assert.ok(gain > 1);
  const after = measure([sine(4, 0.02 * gain)]);
  assert.ok(Math.abs(after.loudness! - LEVEL_TARGET) < 0.1, `read ${after.loudness}`);
  assert.ok(levelGain(-6, 0.9)! < 1);
});

test("gain never pushes peaks past the ceiling or boosts past the limit", () => {
  // Quiet on average but with a tall spike: the peak limits the boost.
  const signal = sine(4, 0.02);
  signal[100] = 0.5;
  const { loudness, peak } = measure([signal]);
  const gain = levelGain(loudness, peak)!;
  assert.ok(Math.abs(peak * gain - 10 ** (LEVEL_CEILING / 20)) < 1e-9);
  assert.ok(levelGain(-100, 1e-6)! <= 10 ** (LEVEL_MAX_BOOST / 20) + 1e-9);
});

test("stereo channels add their power", () => {
  const one = measure([sine(3, 0.1)]).loudness!;
  const two = measure([sine(3, 0.1), sine(3, 0.1)]).loudness!;
  assert.ok(Math.abs(two - one - 3.01) < 0.05);
});
