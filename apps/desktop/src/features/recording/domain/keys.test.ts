import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKey, formatShortcut } from "./keys.ts";

test("shortcuts with command, control or option are drawn in macOS order", () => {
  assert.deepEqual(formatShortcut(8, ["command"]), ["⌘", "C"]);
  assert.deepEqual(formatShortcut(21, ["shift", "command"]), ["⇧", "⌘", "4"]);
  assert.deepEqual(formatShortcut(40, ["command", "option", "control", "shift"]), [
    "⌃",
    "⌥",
    "⇧",
    "⌘",
    "K",
  ]);
  assert.deepEqual(formatShortcut(123, ["option"]), ["⌥", "←"]);
});

test("plain typing and shift-only keys are not shortcuts", () => {
  assert.equal(formatShortcut(0, []), null);
  assert.equal(formatShortcut(0, ["shift"]), null);
});

test("keys that type nothing show without a modifier", () => {
  assert.deepEqual(formatShortcut(53, []), ["⎋"]);
  assert.deepEqual(formatShortcut(48, ["shift"]), ["⇧", "⇥"]);
  assert.deepEqual(formatShortcut(122, []), ["F1"]);
});

test("keys with no known name are skipped", () => {
  assert.equal(formatShortcut(200, ["command"]), null);
  assert.equal(formatKey(200, []), null);
});

test("recorded modifier taps and caps lock are drawn", () => {
  assert.deepEqual(formatKey(56, []), ["⇧"]);
  assert.deepEqual(formatKey(56, ["command"]), ["⌘", "⇧"]);
  assert.deepEqual(formatKey(57, []), ["⇪"]);
  assert.deepEqual(formatKey(8, ["shift", "command"]), ["⇧", "⌘", "C"]);
});
