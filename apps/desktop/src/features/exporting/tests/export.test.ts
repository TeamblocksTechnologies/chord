import assert from "node:assert/strict";
import { test } from "node:test";
import type { Manifest, ManifestTrack } from "@teamblocks.dev/chord-recorder-protocol";
import { audioSpans } from "../renderer/audio.ts";
import { audioGain, audioLevel } from "#features/editing/domain/audioSettings";
import { stillSize } from "../renderer/still.ts";
import {
  aspectOf,
  defaultExportSettings,
  exportSize,
  isTransparent,
} from "../renderer/settings.ts";
import { buildTimeline, sequence, showingOf } from "#media-engine/renderer/timeline";

const display = { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1117 }, scale: 2 };

function session(tracks: ManifestTrack[]) {
  const manifest: Manifest = {
    version: 1,
    id: "s",
    createdAt: "2026-10-20T00:00:00Z",
    hostTimeOrigin: 0,
    config: {} as Manifest["config"],
    tracks,
    pauses: [],
    marks: [],
  };
  return { directory: "/r/s", manifest, bounds: {}, input: [] };
}

const noProbe = async () => assert.fail("nothing to probe");
const file = (url: string) => decodeURIComponent(url).split("/").at(-1);

test("export keeps per-source levels through trims and audio-led recordings, excluding muted sources", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "one.m4a", start: 0, end: 4 }],
      },
      {
        id: "mic-2",
        kind: "microphone",
        source: "mic2",
        segments: [{ file: "two.m4a", start: 0, end: 4 }],
      },
      {
        id: "system",
        kind: "systemAudio",
        source: "system",
        segments: [{ file: "system.m4a", start: 0, end: 4 }],
      },
    ]),
    noProbe,
  ))!;
  const settings = {
    "microphone:0": { volume: 0.4, muted: false },
    "microphone:1": { volume: 0.8, muted: true },
    "systemAudio:0": { volume: 0.25, muted: false },
  };
  const { parts } = sequence([{ recordingId: "r", timeline, start: 1, end: 3 }]);
  assert.deepEqual(
    audioSpans(parts, (_id, kind, index) => audioLevel(settings, kind, index)).map((span) => [
      file(span.url),
      span.start,
      span.fileStart,
      span.duration,
      span.volume,
    ]),
    [
      ["one.m4a", 0, 1, 2, 0.4],
      ["system.m4a", 0, 1, 2, 0.25],
    ],
  );
  assert.ok(
    audioSpans(parts).every((span) => span.volume === 1),
    "Old projects keep their original levels",
  );
});

test("export applies leveling gain on top of volume to leveled sources only, after trims", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "one.m4a", start: 0, end: 4 }],
      },
      {
        id: "mic-2",
        kind: "microphone",
        source: "mic2",
        segments: [{ file: "two.m4a", start: 0, end: 4 }],
      },
    ]),
    noProbe,
  ))!;
  const settings = {
    "microphone:0": { volume: 0.5, muted: false, leveled: true, levelGain: 3 },
    "microphone:1": { volume: 1, muted: false, leveled: false, levelGain: 5 },
  };
  const { parts } = sequence([{ recordingId: "r", timeline, start: 1, end: 3 }]);
  const spans = audioSpans(
    parts,
    (_id, kind, index) => audioLevel(settings, kind, index),
    (_id, kind, index) => audioGain(settings, kind, index),
  );
  assert.deepEqual(
    spans.map((span) => [file(span.url), span.volume, span.fileStart, span.duration]),
    [
      ["one.m4a", 1.5, 1, 2],
      ["two.m4a", 1, 1, 2],
    ],
  );
  const muted = { ...settings, "microphone:0": { ...settings["microphone:0"], muted: true } };
  assert.deepEqual(
    audioSpans(
      parts,
      (_id, kind, index) => audioLevel(muted, kind, index),
      (_id, kind, index) => audioGain(muted, kind, index),
    ).map((span) => file(span.url)),
    ["two.m4a"],
    "Mute still silences a leveled source",
  );
});

test("export sizes put the resolution on the short side, with even sides", () => {
  assert.deepEqual(exportSize(16 / 9, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(exportSize(9 / 16, 1080), { width: 1080, height: 1920 });
  assert.deepEqual(exportSize(1, 720), { width: 720, height: 720 });
  assert.deepEqual(exportSize(4 / 5, 1080), { width: 1080, height: 1350 });
  assert.deepEqual(exportSize(2.1, 2160), { width: 4536, height: 2160 });
  assert.deepEqual(
    exportSize(1728 / 1117, 1080),
    { width: 1670, height: 1080 },
    "An odd width is rounded to even",
  );
  assert.equal(aspectOf("original", 1.5), 1.5);
  assert.equal(aspectOf("4:3", 1.5), 4 / 3);
});

test("only file types that keep transparency export it", () => {
  assert.equal(isTransparent({ ...defaultExportSettings(), transparent: true }), false);
  assert.equal(
    isTransparent({ ...defaultExportSettings(), format: "webm-vp9", transparent: true }),
    true,
  );
  assert.equal(isTransparent({ ...defaultExportSettings(), format: "webm-vp9" }), false);
});

test("each piece shows where no earlier piece covers it", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        segments: [{ file: "screen.mov", start: 0, end: 10 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts } = sequence([
    { id: "top", recordingId: "r", timeline, start: 0, end: 2, offset: 3 },
    { id: "under", recordingId: "r", timeline, start: 0, end: 8, offset: 0 },
    { id: "late", recordingId: "r", timeline, start: 0, end: 2, offset: 10 },
  ]);
  assert.deepEqual(
    showingOf(parts).map(({ part, from, to }) => [part.pieceId, from, to]),
    [
      ["under", 0, 3],
      ["top", 3, 5],
      ["under", 5, 8],
      ["late", 10, 12],
    ],
  );
});

test("audio follows the leading clip on session time, wherever its piece shows", async () => {
  // Paused from 2 to 3: the screen's second segment starts at 3, the microphone records throughout.
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        segments: [
          { file: "screen-1.mov", start: 0, end: 2 },
          { file: "screen-2.mov", start: 3, end: 5 },
        ],
      },
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "mic.m4a", start: 0.5, end: 5 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts } = sequence([{ recordingId: "r", timeline, start: 1, end: 3.5 }]);
  assert.deepEqual(
    audioSpans(parts).map(({ url, start, fileStart, duration }) => [
      file(url),
      start,
      fileStart,
      duration,
    ]),
    [
      ["mic.m4a", 0, 0.5, 1],
      ["mic.m4a", 1, 2.5, 1.5],
    ],
  );

  // Audio that leads plays itself.
  const audioOnly = (await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "mic.m4a", start: 0, end: 4 }],
      },
    ]),
    noProbe,
  ))!;
  const covered = sequence([
    { id: "a", recordingId: "a", timeline: audioOnly, start: 0, end: 1, offset: 1 },
    { id: "b", recordingId: "b", timeline: audioOnly, start: 0, end: 3, offset: 0 },
  ]);
  assert.deepEqual(
    audioSpans(covered.parts).map(({ start, fileStart, duration }) => [start, fileStart, duration]),
    [
      [0, 0, 1],
      [1, 0, 1],
      [2, 2, 1],
    ],
    "A piece on top silences the one under it",
  );
});

test("a still is the largest size of the preview's shape within the video's own pixels, never enlarged", () => {
  const screen = { width: 2880, height: 1800 };
  assert.deepEqual(stillSize(1.6, screen), screen, "The video's own shape keeps every pixel");
  assert.deepEqual(
    stillSize(16 / 9, screen),
    { width: 2880, height: 1620 },
    "A wider shape keeps the width",
  );
  assert.deepEqual(
    stillSize(1, screen),
    { width: 1800, height: 1800 },
    "A taller shape keeps the height",
  );
  assert.deepEqual(stillSize(9 / 16, screen), { width: 1013, height: 1800 });
  assert.deepEqual(stillSize(4 / 5, { width: 1280, height: 720 }), { width: 576, height: 720 });
  const odd = stillSize(1.5, { width: 1001, height: 667 });
  assert.ok(
    odd.width <= 1001 && odd.height <= 667 && Math.abs(odd.width / odd.height - 1.5) < 0.01,
    `An odd source stays within it (${odd.width} × ${odd.height})`,
  );
});
