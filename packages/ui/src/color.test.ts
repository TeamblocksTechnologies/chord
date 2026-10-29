import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHex, toHex, toHsva, toRgba } from "./color.ts";

test("hex edits accept CSS shorthand and alpha, and reject incomplete or invalid drafts", () => {
  assert.deepEqual(parseHex(" #AbC "), { r: 170, g: 187, b: 204, a: 1 });
  assert.equal(toHex(parseHex("abcd")!), "#aabbccdd");
  assert.equal(toHex(parseHex("12345600")!), "#12345600");
  assert.equal(toHex(parseHex("123456ff")!), "#123456");
  assert.equal(toHex(parseHex("12345678")!, false), "#123456");
  for (const input of [
    "",
    "#",
    "12",
    "12345",
    "1234567",
    "#gggggg",
    "red",
    "##123456",
    "123456789",
  ]) {
    assert.equal(parseHex(input), null, input);
  }
});

test("color-space conversions preserve primaries, grayscale, and opacity", () => {
  for (const [hex, h, s, v] of [
    ["ff0000", 0, 1, 1],
    ["00ff00", 120, 1, 1],
    ["0000ff", 240, 1, 1],
    ["ffff00", 60, 1, 1],
    ["00ffff", 180, 1, 1],
    ["ff00ff", 300, 1, 1],
    ["ffffff", 0, 0, 1],
    ["000000", 0, 0, 0],
  ] as const) {
    assert.deepEqual(toHsva(parseHex(hex)!), { h, s, v, a: 1 });
    assert.equal(toHex(toRgba({ h, s, v, a: 1 })), `#${hex}`);
  }
  assert.equal(toHex(toRgba({ h: 360, s: 1, v: 1, a: 0.5 })), "#ff000080");
  assert.equal(toHex(toRgba({ h: -120, s: 1, v: 1, a: 0 })), "#0000ff00");
});

test("round-tripping RGB through the picker preserves every sampled channel exactly", () => {
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17) {
        const original = { r, g, b, a: 0.37 };
        assert.deepEqual(toRgba(toHsva(original)), original);
      }
});
