import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { wav } from "./wav.ts";
import { WavReader, WavWriter } from "./wavFile.ts";

async function readAll(
  file: string,
  stretch: number,
): Promise<{ channels: Float32Array[]; rate: number }> {
  const reader = await WavReader.open(file);
  try {
    const channels = Array.from({ length: reader.channels }, () => [] as number[]);
    for (let samples = await reader.read(stretch); samples; samples = await reader.read(stretch))
      samples.forEach((channel, i) => channels[i]!.push(...channel));
    return { channels: channels.map((channel) => Float32Array.from(channel)), rate: reader.rate };
  } finally {
    await reader.close();
  }
}

test("a written file reads back to within a 24-bit step, in any stretch size, and has the sizes its header says", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-wav-"));
  try {
    const file = join(directory, "out.wav");
    const left = Float32Array.from({ length: 10_001 }, (_, i) => 0.9 * Math.sin(i / 7));
    const right = Float32Array.from({ length: 10_001 }, (_, i) => -0.5 * Math.cos(i / 11));
    const writer = await WavWriter.create(file, 2, 44_100);
    await writer.write([left.slice(0, 3000), right.slice(0, 3000)]);
    await writer.write([left.slice(3000), right.slice(3000)]);
    await writer.close();
    assert.equal(readFileSync(file).length, 44 + 10_001 * 2 * 3);
    for (const stretch of [1, 977, 48_000]) {
      const read = await readAll(file, stretch);
      assert.equal(read.rate, 44_100);
      assert.equal(read.channels.length, 2);
      assert.equal(read.channels[0]!.length, 10_001);
      for (let i = 0; i < left.length; i++)
        assert.ok(
          Math.abs(read.channels[0]![i]! - left[i]!) < 2 / 0x800000 &&
            Math.abs(read.channels[1]![i]! - right[i]!) < 2 / 0x800000,
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("samples beyond full scale are clipped, and an empty file is valid", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-wav-"));
  try {
    const file = join(directory, "loud.wav");
    const writer = await WavWriter.create(file, 1, 48_000);
    await writer.write([Float32Array.of(2, -2, 1, -1, 0)]);
    await writer.close();
    const read = await readAll(file, 10);
    assert.deepEqual(
      [...read.channels[0]!].map((value) => Math.round(value * 0x800000)),
      [0x7fffff, -0x800000, 0x7fffff, -0x800000, 0],
    );
    const empty = join(directory, "empty.wav");
    await (await WavWriter.create(empty, 2, 48_000)).close();
    assert.deepEqual(
      (await readAll(empty, 10)).channels.map((channel) => channel.length),
      [0, 0],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the reader takes the 16-bit files the app writes and refuses what isn't a WAV", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-wav-"));
  try {
    const file = join(directory, "small.wav");
    writeFileSync(file, wav(Float32Array.of(0.5, -0.5, 0.25), 16_000));
    const read = await readAll(file, 2);
    assert.equal(read.rate, 16_000);
    assert.deepEqual(
      [...read.channels[0]!].map((value) => Math.round(value * 100) / 100),
      [0.5, -0.5, 0.25],
    );
    writeFileSync(join(directory, "bad.wav"), "not audio");
    await assert.rejects(WavReader.open(join(directory, "bad.wav")), /Not a WAV file/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "what the writer makes is a WAV other tools read the same way",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "chord-wav-"));
    try {
      const file = join(directory, "tone.wav");
      const tone = Float32Array.from(
        { length: 4800 },
        (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48_000),
      );
      const writer = await WavWriter.create(file, 1, 48_000);
      await writer.write([tone]);
      await writer.close();
      const info = execFileSync("/usr/bin/afinfo", [file]).toString();
      assert.match(info, /1 ch,\s+48000 Hz, lpcm .* 24-bit little-endian signed integer/);
      assert.match(info, /audio packets: 4800/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
