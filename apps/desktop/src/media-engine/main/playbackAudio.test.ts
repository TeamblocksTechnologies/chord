import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PlaybackAudio } from "./playbackAudio.ts";
import { wav } from "#shared/main/wav";

function samplesOf(file: Buffer): Buffer {
  for (let offset = 12; offset + 8 <= file.length;) {
    const size = file.readUInt32LE(offset + 4);
    if (file.toString("ascii", offset, offset + 4) === "data")
      return file.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no sample data");
}

test(
  "lossless playback copies share conversions, refresh changed sources and clean up",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "chord-audio-test-"));
    const cache = new PlaybackAudio();
    try {
      const input = join(directory, "input.wav");
      const source = join(directory, "mic.m4a");
      const samples = new Float32Array([0, 1, -1, 0.5, -0.5]);
      writeFileSync(input, wav(samples, 48_000));
      execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "alac", input, source]);
      const original = readFileSync(source);
      const copies = await Promise.all([cache.file(source), cache.file(source)]);
      assert.equal(copies[0], copies[1], "Concurrent media and waveform requests use one copy");
      assert.deepEqual(readFileSync(source), original);

      // Decode the playback copy back to the source's PCM format to verify samples and sample rate exactly.
      const roundtrip = join(directory, "roundtrip.wav");
      execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16", copies[0]!, roundtrip]);
      assert.equal(readFileSync(roundtrip).readUInt32LE(24), 48_000);
      assert.deepEqual(samplesOf(readFileSync(roundtrip)), samplesOf(readFileSync(input)));
      assert.equal(await cache.file(source), copies[0]);

      writeFileSync(source, "broken audio");
      await assert.rejects(cache.file(source), /can't be decoded/);
      rmSync(source);
      execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "alac", input, source]);
      const refreshed = await cache.file(source);
      assert.notEqual(refreshed, copies[0], "A failed conversion can be retried");
      cache.dispose();
      assert.equal(existsSync(dirname(refreshed)), false, "Temporary decoded files are removed");
      await assert.rejects(cache.file(source), /closed/);
    } finally {
      cache.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
