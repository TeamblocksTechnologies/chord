import assert from "node:assert/strict";
import { test } from "node:test";
import { type PreviewFrame, readPreviewFrames } from "../src/index.ts";

function frame(id: string, image: number[]): number[] {
  const name = [...new TextEncoder().encode(id)];
  const length = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return [...length(name.length), ...name, ...length(image.length), ...image];
}

test("readPreviewFrames reassembles frames split across chunks", () => {
  const frames: PreviewFrame[] = [];
  const feed = readPreviewFrames((f) => frames.push(f));
  const bytes = [...frame("display-1", [1, 2, 3]), ...frame("é", []), ...frame("b", [9])];
  // One byte at a time, then the rest at once.
  for (const byte of bytes.slice(0, 10)) feed(new Uint8Array([byte]));
  feed(new Uint8Array(bytes.slice(10)));
  assert.deepEqual(frames, [
    { id: "display-1", image: new Uint8Array([1, 2, 3]) },
    { id: "é", image: new Uint8Array([]) },
    { id: "b", image: new Uint8Array([9]) },
  ]);
});
