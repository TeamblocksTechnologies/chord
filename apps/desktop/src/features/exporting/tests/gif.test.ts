import assert from "node:assert/strict";
import { test } from "node:test";
import { GifFrames } from "../renderer/gifFrames.ts";
import {
  defaultExportSettings,
  frameCount,
  gifDelay,
  gifSize,
  isTransparent,
  rangeWithin,
} from "../renderer/settings.ts";
import { captionCues } from "#media-engine/renderer/captions";
import { formatBytes, formatTimecode, parseTimecode } from "#shared/domain/format";

/** The parts of a GIF that say how it plays: its size, whether and how it loops, and each frame's timing and drawing. */
function readGif(bytes: Uint8Array) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), "GIF89a");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true),
    height = view.getUint16(8, true);
  let at = 13 + (bytes[10]! & 0x80 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0);
  let loops: number | null = null;
  const frames: {
    delay: number;
    dispose: number;
    transparent: boolean;
    width: number;
    height: number;
  }[] = [];
  let control = { delay: 0, dispose: 0, transparent: false };
  const skipBlocks = () => {
    while (bytes[at]! !== 0) at += bytes[at]! + 1;
    at++;
  };
  for (;;) {
    const kind = bytes[at++]!;
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = bytes[at++]!;
      if (label === 0xf9) {
        const packed = bytes[at + 1]!;
        control = {
          delay: view.getUint16(at + 2, true),
          dispose: (packed >> 2) & 7,
          transparent: (packed & 1) === 1,
        };
      } else if (
        label === 0xff &&
        new TextDecoder().decode(bytes.subarray(at + 1, at + 12)) === "NETSCAPE2.0"
      ) {
        loops = view.getUint16(at + 14, true);
      }
      skipBlocks();
    } else if (kind === 0x2c) {
      const packed = bytes[at + 8]!;
      frames.push({
        ...control,
        width: view.getUint16(at + 4, true),
        height: view.getUint16(at + 6, true),
      });
      at += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0) + 1;
      skipBlocks();
    } else {
      assert.fail(`Unexpected block ${kind} at ${at - 1}`);
    }
  }
  assert.equal(at, bytes.length, "Nothing follows the trailer");
  return { width, height, loops, frames };
}

/** A `width` × `height` frame of flat `color`, with a white square at `square`. */
function frame(width: number, height: number, color: number[], square?: [number, number]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside =
        square && x >= square[0] && x < square[0] + 4 && y >= square[1] && y < square[1] + 4;
      rgba.set(inside ? [255, 255, 255, 255] : [...color, 255], (y * width + x) * 4);
    }
  return rgba;
}

function encode(frames: Uint8Array[], loop: boolean, delay = 7) {
  const gif = new GifFrames(32, 24, loop);
  const chunks = frames.map((rgba) => gif.add(rgba, delay));
  chunks.push(gif.finish());
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { gif, chunks, bytes };
}

test("GIF frames keep time in hundredths of a second without drifting", () => {
  for (const rate of [10, 15, 24]) {
    const second = Array.from({ length: rate }, (_, frame) => gifDelay(frame, rate));
    assert.equal(
      second.reduce((a, b) => a + b),
      100,
      `${rate} fps adds up to a second`,
    );
    assert.ok(
      second.every((delay) => delay >= 2),
      "No delay is short enough for browsers to slow it down",
    );
  }
  assert.deepEqual(
    Array.from({ length: 6 }, (_, frame) => gifDelay(frame, 15)),
    [7, 6, 7, 7, 6, 7],
  );
  assert.equal(frameCount(12.5, 15), 188);
  assert.equal(frameCount(0.01, 10), 1, "There's always a frame");
});

test("GIFs are the chosen width, as tall as the shape, and never transparent", () => {
  assert.deepEqual(gifSize(16 / 9, 640), { width: 640, height: 360 });
  assert.deepEqual(gifSize(9 / 16, 480), { width: 480, height: 853 });
  assert.equal(
    isTransparent({ ...defaultExportSettings(), format: "gif", transparent: true }),
    false,
  );
});

test("an export range stays within the project", () => {
  assert.deepEqual(rangeWithin(null, 40), { start: 0, end: 40 });
  assert.deepEqual(rangeWithin({ start: -2, end: 50 }, 40), { start: 0, end: 40 });
  assert.deepEqual(rangeWithin({ start: 10, end: 5 }, 40), { start: 10, end: 10 });
});

test("captions for a range are only its own, timed from its start", () => {
  const words = (text: string) => text.split(" ").map((word) => ({ text: word })) as never;
  const lines = [
    { start: 1, end: 3, words: words("before it") },
    { start: 4, end: 7, words: words("across the start") },
    { start: 8, end: 9, words: words("inside") },
    { start: 12, end: 14, words: words("after") },
  ];
  assert.deepEqual(captionCues(lines, { start: 5, end: 10 }), [
    { start: 0, end: 2, text: "across the start" },
    { start: 3, end: 4, text: "inside" },
  ]);
  assert.equal(captionCues(lines).length, 4, "The whole project keeps every caption");
});

test("typed times read as minutes and seconds", () => {
  assert.equal(formatTimecode(65.34), "1:05.3");
  assert.equal(formatTimecode(0), "0:00.0");
  assert.equal(parseTimecode("1:05.3"), 65.3);
  assert.equal(parseTimecode(" 12 "), 12);
  assert.equal(parseTimecode("1:02:05"), 3725);
  assert.equal(parseTimecode(".5"), 0.5);
  for (const text of ["", "1:", "a", "-3", "1:2:3:4"])
    assert.equal(parseTimecode(text), null, text);
  assert.match(formatBytes(640_000), /640\s?kB/);
});

test("a GIF loops forever or plays once, and is streamed as it's encoded", () => {
  const frames = [
    frame(32, 24, [20, 40, 200], [2, 2]),
    frame(32, 24, [20, 40, 200], [10, 2]),
    frame(32, 24, [20, 40, 200], [18, 2]),
  ];
  const looped = encode(frames, true);
  const read = readGif(looped.bytes);
  assert.deepEqual([read.width, read.height, read.loops], [32, 24, 0], "Loop count 0 is forever");
  assert.equal(read.frames.length, 3);
  assert.equal(
    looped.chunks[0]!.length,
    0,
    "The first frame waits until it's known how long it shows",
  );
  assert.ok(
    looped.chunks[1]!.length > 0 && looped.chunks[2]!.length > 0,
    "Each later frame hands on the one before",
  );
  assert.ok(looped.gif.firstBytes > 0 && looped.gif.firstBytes < looped.bytes.length);
  assert.equal(
    readGif(encode(frames, false).bytes).loops,
    null,
    "Playing once leaves the loop extension out",
  );
});

test("later GIF frames draw only what changed, and still frames lengthen the one before", () => {
  const blue = frame(32, 24, [20, 40, 200]);
  // Decoded video drifts a little even when the picture is still.
  const drifted = frame(32, 24, [22, 38, 203]);
  const moved = frame(32, 24, [20, 40, 200], [8, 8]);
  const { bytes, gif } = encode([blue, drifted, blue, moved, moved], true);
  const { frames } = readGif(bytes);
  assert.equal(gif.frames, 2);
  assert.deepEqual(
    frames.map((f) => f.delay),
    [21, 14],
    "Still frames add their time to the frame showing",
  );
  assert.equal(
    frames.reduce((total, f) => total + f.delay, 0),
    35,
    "The whole GIF keeps its length",
  );
  assert.deepEqual(
    frames.map((f) => [f.width, f.height]),
    [
      [32, 24],
      [32, 24],
    ],
  );
  assert.deepEqual(
    frames.map((f) => f.transparent),
    [false, true],
    "The first frame is whole; later ones show it through",
  );
  assert.ok(
    frames.every((f) => f.dispose === 1),
    "Each frame is left showing under the next",
  );
  assert.throws(() => new GifFrames(32, 24, true).add(new Uint8Array(10), 7), /32 × 24/);
});
