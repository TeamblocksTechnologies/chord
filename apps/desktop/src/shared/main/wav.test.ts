import assert from "node:assert/strict";
import { test } from "node:test";
import { wav } from "./wav.ts";

test("encodes mono 16-bit PCM with a header that matches the samples", () => {
  const file = wav(new Float32Array([0, 1, -1, 0.5, 2]), 16_000);
  assert.equal(file.toString("ascii", 0, 4), "RIFF");
  assert.equal(file.readUInt32LE(4), file.length - 8);
  assert.equal(file.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(file.readUInt16LE(20), 1);
  assert.equal(file.readUInt16LE(22), 1);
  assert.equal(file.readUInt32LE(24), 16_000);
  assert.equal(file.readUInt32LE(28), 32_000);
  assert.equal(file.toString("ascii", 36, 40), "data");
  assert.equal(file.readUInt32LE(40), 10);
  // Past full scale clips.
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => file.readInt16LE(44 + i * 2)),
    [0, 32767, -32768, 16384, 32767],
  );
});
