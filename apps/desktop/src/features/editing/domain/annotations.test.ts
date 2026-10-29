import assert from "node:assert/strict";
import { test } from "node:test";
import { isAnnotations, noAnnotations, normalizeSpans, spanAt } from "./annotations.ts";
import {
  annotationsOfLayers,
  editedVisualLayers,
  normalizeVisualLayers,
  visualLayersOf,
  type VisualLayer,
} from "./visualLayers.ts";
import { Stage } from "#media-engine/renderer/stage";
import type { Clip, Part, Timeline } from "#media-engine/renderer/timeline";

test("spans are put in order within the recording, joining overlaps and dropping slivers", () => {
  assert.deepEqual(
    normalizeSpans(
      [
        { start: 5, end: 7 },
        { start: -1, end: 2 },
        { start: 6, end: 12 },
        { start: 3, end: 3.01 },
        { start: 2, end: 2.5 },
      ],
      10,
    ),
    [
      { start: 0, end: 2.5 },
      { start: 5, end: 10 },
    ],
  );
  // Dragged backwards.
  assert.deepEqual(normalizeSpans([{ start: 4, end: 1 }]), [{ start: 1, end: 4 }]);
});

test("the span on at a time includes its start but not its end", () => {
  const spans = [{ start: 1, end: 2 }];
  assert.equal(spanAt(spans, 1), spans[0]);
  assert.equal(spanAt(spans, 2), undefined);
});

test("stored spans are checked", () => {
  assert.equal(isAnnotations(noAnnotations()), true);
  assert.equal(isAnnotations({ laser: [], clicks: [] }), false);
  assert.equal(isAnnotations({ ...noAnnotations(), keys: [{ start: 0 }] }), false);
});

test("legacy effects become stable layers and repeated effects retain independent coverage through cuts and reloads", () => {
  const recording = {
    mode: "display" as const,
    hasCamera: true,
    annotations: { ...noAnnotations(), laser: [{ start: 0.5, end: 3 }] },
    annotationTracks: ["clicks" as const],
  };
  const original = visualLayersOf(recording);
  assert.deepEqual(
    original.map((layer) => layer.id),
    ["camera:0", "laser:0", "clicks:0", "screen:0"],
  );
  assert.deepEqual(visualLayersOf(JSON.parse(JSON.stringify(recording))), original);
  const copy = {
    id: "another-laser",
    kind: "laser" as const,
    name: "Laser pointer 2",
    spans: [{ start: 2, end: 4 }],
  };
  const restored = normalizeVisualLayers(
    recording,
    JSON.parse(JSON.stringify([...original].reverse().concat(copy))),
  );
  assert.deepEqual(
    restored.map((layer) => layer.id),
    ["camera:0", "laser:0", "another-laser", "clicks:0", "screen:0"],
    "Previously saved order becomes the fixed composition",
  );
  const edited = editedVisualLayers(restored, [{ start: 1, end: 2 }]);
  assert.deepEqual(
    edited.find((layer) => layer.id === "another-laser"),
    { ...copy, spans: [{ start: 1, end: 3 }] },
  );
  assert.deepEqual(
    edited.find((layer) => layer.id === "laser:0"),
    { id: "laser:0", kind: "laser", spans: [{ start: 0.5, end: 2 }] },
  );
  assert.deepEqual(annotationsOfLayers(restored).laser, [{ start: 0.5, end: 4 }]);
  assert.deepEqual(
    visualLayersOf({ ...recording, visualLayers: [] }).map((layer) => layer.kind),
    ["camera", "screen"],
    "Deleted effects do not return from legacy coverage",
  );
  assert.deepEqual(
    normalizeVisualLayers(recording, [
      null,
      { id: "bad", kind: "unknown" },
      ...original,
      original[0],
    ]),
    original,
  );
});

test("the shared preview/export stage keeps camera above annotations regardless of saved order", () => {
  const names = ["document", "getComputedStyle", "OffscreenCanvas"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.assign(globalThis, {
    document: { createElement: () => ({}), documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    OffscreenCanvas: class {
      getContext() {
        return {};
      }
    },
  });
  try {
    const painted: string[] = [];
    const context = new Proxy(
      {
        canvas: { width: 100, height: 100 },
        drawImage: (image: { tag: string }) => painted.push(image.tag),
        arc: () => painted.push("laser"),
      },
      {
        get(target, name) {
          return Reflect.get(target, name) ?? (() => {});
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const stage = new Stage(1);
    const screen = {
      tag: "screen",
      displayWidth: 100,
      displayHeight: 100,
    } as unknown as VideoFrame;
    const camera = {
      image: { tag: "camera" } as unknown as CanvasImageSource,
      width: 100,
      height: 100,
    };
    const timeline = {
      lead: "screen",
      screen: { area: { x: 0, y: 0, width: 100, height: 100 } },
      video: [
        { id: "screen", kind: "screen", index: 0, lead: true, clips: [] },
        { id: "camera", kind: "camera", index: 0, lead: false, clips: [] },
      ],
      input: { cursor: [{ time: 0, x: 85, y: 85 }], clicks: [], keys: [] },
    } as unknown as Timeline;
    const part = { recordingId: "take", offset: 0, start: 0, end: 4, timeline } as Part;
    let layers: VisualLayer[] = [
      { id: "camera", kind: "camera" },
      { id: "laser-a", kind: "laser", spans: [{ start: 0, end: 1 }] },
      { id: "laser-b", kind: "laser", spans: [{ start: 2, end: 3 }] },
      { id: "screen", kind: "screen" },
    ];
    stage.layers = () => layers;
    const draw = (time: number) => {
      painted.length = 0;
      stage.draw(context, { part, clip: { focused: false } as Clip, time, screen, camera });
      return [...painted];
    };
    assert.deepEqual(draw(0.5), ["screen", "laser", "camera"]);
    layers = [...layers].reverse();
    assert.deepEqual(
      draw(0.5),
      ["screen", "laser", "camera"],
      "Reversed saved layers keep the camera in front",
    );
    assert.deepEqual(
      draw(2.5),
      ["screen", "laser", "camera"],
      "The second laser keeps its own coverage",
    );
    assert.deepEqual(draw(1.5), ["screen", "camera"], "Neither laser is enabled between its spans");
  } finally {
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
