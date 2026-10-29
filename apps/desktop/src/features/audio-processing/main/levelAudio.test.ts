import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { measureLevel } from "./levelAudio.ts";
import { PlaybackAudio } from "#media-engine/main/playbackAudio";
import { wav } from "#shared/main/wav";
import { LEVEL_CEILING, LEVEL_TARGET } from "../domain/loudness.ts";

const RATE = 48_000;
const tone = (seconds: number, amplitude: number) =>
  Float32Array.from(
    { length: seconds * RATE },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE),
  );
const identity = async (file: string) => file;

test("measuring a take reads every file of it and levels it to the target under the ceiling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chord-level-"));
  try {
    const [first, second, silent] = ["first.wav", "second.wav", "silent.wav"].map((name) =>
      join(directory, name),
    );
    writeFileSync(first!, wav(tone(3, 0.03), RATE));
    writeFileSync(second!, wav(tone(3, 0.03), RATE));
    writeFileSync(silent!, wav(new Float32Array(RATE * 2), RATE));
    const gain = (await measureLevel([first!, second!], identity))!;
    assert.ok(gain > 1, "A quiet take is raised");
    // The same samples scaled by the gain land on the target, with peaks under the ceiling.
    const levelled = join(directory, "levelled.wav");
    writeFileSync(levelled, wav(tone(3, 0.03 * gain), RATE));
    assert.ok(0.03 * gain <= 10 ** (LEVEL_CEILING / 20) + 1e-3);
    const again = (await measureLevel([levelled], identity))!;
    assert.ok(
      Math.abs(20 * Math.log10(again)) < 0.2,
      `Leveled audio needs no further gain, wanted ${LEVEL_TARGET} LUFS`,
    );
    assert.equal(await measureLevel([silent!], identity), null, "Silence has nothing to level");
    assert.equal(await measureLevel([], identity), null);
    writeFileSync(join(directory, "broken.wav"), "not audio");
    await assert.rejects(measureLevel([join(directory, "broken.wav")], identity));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "measuring decodes the recorder's lossless files without changing them",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "chord-level-"));
    const cache = new PlaybackAudio();
    try {
      const input = join(directory, "input.wav");
      const source = join(directory, "mic.m4a");
      writeFileSync(input, wav(tone(3, 0.05), RATE));
      execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "alac", input, source]);
      const fromAlac = (await measureLevel([source], (file) => cache.file(file)))!;
      const fromWav = (await measureLevel([input], identity))!;
      assert.ok(
        Math.abs(fromAlac / fromWav - 1) < 0.01,
        "Lossless decoding measures the same samples",
      );
    } finally {
      cache.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
