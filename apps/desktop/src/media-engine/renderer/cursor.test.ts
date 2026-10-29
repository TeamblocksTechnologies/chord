import assert from "node:assert/strict";
import { test } from "node:test";
import type { InputEvent } from "@teamblocks.dev/chord-recorder-protocol";
import { IDLE, SMOOTHING, cursorAt, drawCursor, idleOpacity, shapeAt } from "./cursor.ts";
import { drawEffect } from "./effects.ts";
import {
  inputOnPlayback,
  withCuts,
  type Clip,
  type CursorSample,
  type PlaybackInput,
  type Timeline,
} from "./timeline.ts";
import {
  annotationsOfLayers,
  editedVisualLayers,
  normalizeVisualLayers,
  type VisualLayer,
} from "#features/editing/domain/visualLayers";

/** A cursor shaking a point either way of a straight line, sampled every 10 ms as the helper polls it. */
function jittery(duration: number, from = 0): CursorSample[] {
  return Array.from({ length: Math.round(duration * 100) }, (_, i) => ({
    time: from + i / 100,
    x: 100 + i * 2,
    y: 100 + (i % 2 ? 3 : -3),
  }));
}

/** Whether two points are the same, to within rounding. */
function near(
  a: { x: number; y: number } | undefined,
  b: { x: number; y: number } | undefined,
  message?: string,
): void {
  assert.ok(
    a && b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6,
    message ?? `${JSON.stringify(a)} isn't ${JSON.stringify(b)}`,
  );
}

function input(cursor: CursorSample[], clicks: PlaybackInput["clicks"] = []): PlaybackInput {
  return { cursor, clicks, keys: [] };
}

test("smoothing takes the jitter out of the recorded path", () => {
  const path = input(jittery(2));
  const wobble = (smooth: boolean) =>
    Math.max(
      ...Array.from({ length: 100 }, (_, i) =>
        Math.abs(cursorAt(path, 0.5 + i / 100, smooth)!.y - 100),
      ),
    );
  assert.equal(wobble(false), 3);
  assert.ok(wobble(true) < 0.5, `still wobbles by ${wobble(true)}`);
  // Along the line, it keeps up rather than trailing behind.
  assert.ok(Math.abs(cursorAt(path, 1, true)!.x - cursorAt(path, 1, false)!.x) < 2);
});

test("the smoothed cursor is exactly where it was recorded while a button is down, and eases back after", () => {
  const press = { time: 1, end: 1.4, button: "left" as const, x: 300, y: 103 };
  const path = input(jittery(2), [press]);
  for (const time of [1, 1.05, 1.2, 1.4])
    near(cursorAt(path, time, true), cursorAt(path, time, false), `off at ${time}`);
  // Long after the press it's smoothed again.
  assert.ok(Math.abs(cursorAt(path, 1.8, true)!.y - 100) < 0.5);
  // Partway through the blend, it's between the two.
  const raw = cursorAt(path, 1.46, false)!;
  const blended = cursorAt(path, 1.46, true)!;
  assert.ok(Math.abs(blended.y - 100) > 0.1 && Math.abs(blended.y - 100) < Math.abs(raw.y - 100));
});

test("smoothing doesn't run across a cut or a jump", () => {
  const before = Array.from({ length: 100 }, (_, i) => ({ time: i / 100, x: 100, y: 100 }));
  const after = Array.from({ length: 100 }, (_, i) => ({
    time: 1 + i / 100,
    x: 400,
    y: 400,
    ...(i === 0 && { cut: true as const }),
  }));
  for (const path of [
    input([...before, ...after]),
    input([...before, ...after.map(({ cut: _, ...sample }) => ({ ...sample, x: 1400 }))]),
  ]) {
    // Just before, it isn't drawn towards what's after; just after, it's already there.
    near(cursorAt(path, 0.99, true), { x: 100, y: 100 });
    near(cursorAt(path, 1.001, true), cursorAt(path, 1.001, false));
  }
});

test("the smoothed path is the same however it's sampled", () => {
  const samples = jittery(3);
  const forward = input(samples);
  const backward = input(samples.map((sample) => ({ ...sample })));
  const times = Array.from({ length: 50 }, (_, i) => 0.1 + i * 0.0573);
  const ahead = times.map((time) => cursorAt(forward, time, true));
  const behind = [...times]
    .reverse()
    .map((time) => cursorAt(backward, time, true))
    .reverse();
  assert.deepEqual(ahead, behind);
});

test("an idle cursor fades out, and back in as it moves", () => {
  const moves = [...jittery(1), ...jittery(0.5, 5)];
  const path = input(moves);
  assert.equal(idleOpacity(path, 0), 1, "It shows at the start without fading in");
  assert.equal(idleOpacity(path, 1 + IDLE - 0.1), 1);
  assert.equal(idleOpacity(path, 1 + IDLE + 1), 0);
  assert.ok(idleOpacity(path, 5.02) > 0 && idleOpacity(path, 5.02) < 1, "It fades back in");
  assert.equal(idleOpacity(path, 5.3), 1);
  // A press counts as use, even without moving.
  assert.equal(
    idleOpacity(input(moves, [{ time: 3, end: 3.1, button: "left", x: 0, y: 0 }]), 3.5),
    1,
  );
});

test("shapes are placed on the playback timeline, and cut like the path", () => {
  const shape = (time: number, image: string, kind?: "arrow" | "iBeam"): InputEvent => ({
    type: "cursor",
    time,
    image,
    width: 28,
    height: 40,
    hotspotX: 5,
    hotspotY: 5,
    ...(kind && { kind }),
  });
  const events: InputEvent[] = [
    { type: "move", time: 0, x: 1, y: 1 },
    shape(0, "cursors/a.png", "arrow"),
    shape(1.5, "cursors/b.png", "iBeam"),
    { type: "move", time: 3.5, x: 2, y: 2 },
    shape(3.5, "cursors/a.png", "arrow"),
  ];
  // Two clips either side of a pause from 2 to 3.
  const clips = [
    { url: "", file: "1.mov", start: 0, duration: 2, offset: 0, focused: false },
    { url: "", file: "2.mov", start: 3, duration: 2, offset: 2, focused: false },
  ] satisfies Clip[];
  const placed = inputOnPlayback(clips, events);
  assert.deepEqual(
    placed.shapes?.map(({ time, image, cut }) => ({ time, image, ...(cut && { cut }) })),
    [
      { time: 0, image: "cursors/a.png", cut: true },
      { time: 1.5, image: "cursors/b.png" },
      { time: 2, image: "cursors/b.png", cut: true },
      { time: 2.5, image: "cursors/a.png" },
    ],
  );
  assert.equal(shapeAt(placed, 2.1)?.kind, "iBeam");
  // Cutting 1 to 2.2 leaves the text cursor showing where the cut closes up.
  const timeline = {
    clips,
    duration: 4,
    input: placed,
    camera: [],
    audio: [],
    lead: "screen",
  } as unknown as Timeline;
  const cut = withCuts(timeline, [{ start: 1, end: 2.2 }]).input!;
  assert.equal(shapeAt(cut, 1.05)?.kind, "iBeam");
  assert.equal(shapeAt(cut, 1.4)?.kind, "arrow");
  // Sessions recorded before shapes were have none.
  assert.equal(
    inputOnPlayback(
      clips,
      events.filter((event) => event.type !== "cursor"),
    ).shapes,
    undefined,
  );
});

function canvas() {
  const calls: { name: string; args: unknown[] }[] = [];
  const context = new Proxy(
    { canvas: { width: 200, height: 200 }, globalAlpha: 1 },
    {
      get(target, name) {
        return (
          Reflect.get(target, name) ??
          ((...args: unknown[]) => calls.push({ name: String(name), args }))
        );
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

test("the cursor is drawn from its shape's image with the hotspot where the cursor is, or as the pointer without one", () => {
  const image = { tag: "beam" } as unknown as CanvasImageSource;
  const path: PlaybackInput = {
    ...input([{ time: 0, x: 50, y: 60 }]),
    shapes: [
      { time: 0, image: "cursors/b.png", width: 20, height: 22, hotspotX: 10, hotspotY: 11 },
    ],
    images: { "cursors/b.png": image },
  };
  const projection = { x: 0, y: 0, scale: 2 };
  const drawn = canvas();
  drawCursor(drawn.context, path, 0.5, projection, {
    size: 1.5,
    hideWhenIdle: false,
    smooth: false,
  });
  assert.deepEqual(drawn.calls.find((call) => call.name === "drawImage")?.args, [
    image,
    100 - 30,
    120 - 33,
    60,
    66,
  ]);
  // Without its image, it's the standard pointer, tip on the spot.
  const fallback = canvas();
  drawCursor(fallback.context, { ...path, images: {} }, 0.5, projection);
  assert.ok(!fallback.calls.some((call) => call.name === "drawImage"));
  assert.deepEqual(fallback.calls.find((call) => call.name === "translate")?.args, [100, 120]);
});

test("the cursor shows only in its spans, and gives way to the laser", () => {
  const path = input([{ time: 0, x: 50, y: 60 }]);
  const draws = (time: number, laser = [{ start: 2, end: 3 }]) => {
    const { context, calls } = canvas();
    drawEffect(
      context,
      path,
      "cursor",
      [{ start: 0, end: 4 }],
      time,
      { x: 0, y: 0, scale: 1 },
      "blue",
      { laser },
    );
    return calls.some((call) => call.name === "translate");
  };
  assert.equal(draws(1), true);
  assert.equal(draws(2.5), false);
  assert.equal(draws(4.5), false);
});

test("a recording keeps one cursor layer, with its style in range", () => {
  const recording = {
    mode: "display" as const,
    hasCamera: false,
    annotations: { laser: [], clicks: [], keys: [] },
  };
  const layers = normalizeVisualLayers(recording, [
    { id: "c", kind: "cursor", spans: [{ start: 0, end: 4 }], cursor: { size: 9, smooth: false } },
    { id: "d", kind: "cursor", spans: [] },
    { id: "laser", kind: "laser", spans: [{ start: 1, end: 2 }] },
  ]);
  assert.deepEqual(
    layers.filter((layer) => layer.kind === "cursor"),
    [
      {
        id: "c",
        kind: "cursor",
        spans: [{ start: 0, end: 4 }],
        cursor: { size: 3, hideWhenIdle: false, smooth: false },
      },
    ],
  );
  assert.deepEqual(
    annotationsOfLayers(layers),
    { laser: [{ start: 1, end: 2 }], clicks: [], keys: [] },
    "The cursor isn't an effect switched on while recording",
  );
  const edited = editedVisualLayers(layers, [{ start: 1, end: 2 }]) as VisualLayer[];
  assert.deepEqual(
    edited.find((layer) => layer.kind === "cursor"),
    { ...layers.find((layer) => layer.kind === "cursor"), spans: [{ start: 0, end: 3 }] },
  );
});

test("smoothing reaches only a few deviations either way", () => {
  // A single step: well before it the cursor hasn't moved, well after it has arrived.
  const steps = [
    { time: 0, x: 0, y: 0 },
    { time: 1, x: 100, y: 0 },
    { time: 2, x: 100, y: 0 },
  ];
  const path = input(steps);
  assert.equal(cursorAt(path, 1 - 4 * SMOOTHING, true)!.x, 0);
  assert.ok(Math.abs(cursorAt(path, 1 + 4 * SMOOTHING, true)!.x - 100) < 1e-6);
  assert.ok(Math.abs(cursorAt(path, 1, true)!.x - 50) < 10);
});
