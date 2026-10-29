import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Networks } from "./deepFilter.ts";
import { denoiseWav } from "./denoiseFile.ts";
import { WavReader, WavWriter } from "#shared/main/wavFile";

/** Networks that call everything clean, so the file comes back as it went in. */
const clean: Networks = {
  async run(frames) {
    return {
      gains: new Float32Array(frames * 32).fill(1),
      coefs: new Float32Array(frames * 96 * 10),
      lsnr: new Float32Array(frames).fill(100),
    };
  },
};

async function write(file: string, channels: Float32Array[], rate = 48_000): Promise<void> {
  const writer = await WavWriter.create(file, channels.length, rate);
  await writer.write(channels);
  await writer.close();
}

async function read(file: string): Promise<{ channels: Float32Array[]; rate: number }> {
  const reader = await WavReader.open(file);
  try {
    const parts = Array.from({ length: reader.channels }, () => [] as Float32Array[]);
    for (let samples = await reader.read(5000); samples; samples = await reader.read(5000))
      samples.forEach((channel, i) => parts[i]!.push(channel));
    return {
      rate: reader.rate,
      channels: parts.map((chunks) => Float32Array.from(chunks.flatMap((chunk) => [...chunk]))),
    };
  } finally {
    await reader.close();
  }
}

const signal = (length: number, pitch: number) =>
  Float32Array.from({ length }, (_, i) => 0.4 * Math.sin((2 * Math.PI * pitch * i) / 48_000));

test("each channel of a stereo file comes back in place, the same length, as 24-bit audio at the same rate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-denoise-"));
  try {
    const [source, output] = [join(directory, "in.wav"), join(directory, "out.wav")];
    const [left, right] = [signal(23_457, 300), signal(23_457, 2000)];
    await write(source, [left, right]);
    const fractions: number[] = [];
    await denoiseWav(clean, source, output, {}, (fraction) => fractions.push(fraction));
    const result = await read(output);
    assert.equal(result.rate, 48_000);
    assert.equal(result.channels.length, 2);
    for (const [index, original] of [left, right].entries()) {
      assert.equal(result.channels[index]!.length, original.length);
      let worst = 0;
      for (let i = 0; i < original.length; i++)
        worst = Math.max(worst, Math.abs(result.channels[index]![i]! - original[i]!));
      assert.ok(worst < 1e-5, `channel ${index} differed by ${worst}`);
    }
    assert.equal(fractions.at(-1), 1);
    assert.ok(
      fractions.every((value, i) => i === 0 || value >= fractions[i - 1]! - 1e-9),
      "progress never goes back",
    );
    assert.equal(existsSync(`${output}.partial`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an empty file gives an empty file, and audio that isn't 48 kHz is refused", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-denoise-"));
  try {
    const [empty, other, output] = ["empty.wav", "other.wav", "out.wav"].map((name) =>
      join(directory, name),
    ) as [string, string, string];
    await write(empty, [new Float32Array(0)]);
    await denoiseWav(clean, empty, output);
    assert.equal((await read(output)).channels[0]!.length, 0);
    await write(other, [signal(1000, 440)], 44_100);
    await assert.rejects(denoiseWav(clean, other, join(directory, "no.wav")), /48 kHz/);
    assert.equal(existsSync(join(directory, "no.wav")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failure or cancellation leaves no output, and an earlier result is kept", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-denoise-"));
  try {
    const [source, output] = [join(directory, "in.wav"), join(directory, "out.wav")];
    await write(source, [signal(48_000 * 3, 440), signal(48_000 * 3, 880)]);
    await denoiseWav(clean, source, output);
    const before = await read(output);

    const broken: Networks = {
      async run() {
        throw new Error("the model fell over");
      },
    };
    await assert.rejects(denoiseWav(broken, source, output), /fell over/);
    assert.deepEqual(await read(output), before, "the earlier result is untouched");
    assert.equal(existsSync(`${output}.partial`), false);

    const controller = new AbortController();
    const slow: Networks = {
      async run(frames, erb, spec) {
        controller.abort(new Error("cancelled"));
        return clean.run(frames, erb, spec);
      },
    };
    await assert.rejects(
      denoiseWav(slow, source, output, {}, undefined, controller.signal),
      /cancelled/,
    );
    assert.deepEqual(await read(output), before);
    assert.equal(existsSync(`${output}.partial`), false);

    const already = new AbortController();
    already.abort(new Error("never started"));
    await assert.rejects(
      denoiseWav(clean, source, output, {}, undefined, already.signal),
      /never started/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
