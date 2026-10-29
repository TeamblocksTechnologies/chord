import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type CameraOptions,
  DEFAULT_CAMERA_OPTIONS,
  type Rect,
  type ShownSample,
  cameraAt,
  classify,
  fit,
  planCamera,
  toHolds,
  toRect,
} from "./camera.ts";

const area: Rect = { x: 0, y: 0, width: 1728, height: 1117 };
const options: CameraOptions = { ...DEFAULT_CAMERA_OPTIONS, aspect: 16 / 9, area };
const window: Rect = { x: 160, y: 150, width: 1000, height: 600 };
/** The window with a context menu hanging off its bottom edge. */
const withMenu: Rect = { ...window, height: 800 };

function contains(outer: Rect, inner: Rect): boolean {
  const slack = 0.5;
  return (
    outer.x <= inner.x + slack &&
    outer.y <= inner.y + slack &&
    outer.x + outer.width >= inner.x + inner.width - slack &&
    outer.y + outer.height >= inner.y + inner.height - slack
  );
}

function fitted(frame: Rect): Rect {
  return toRect(fit(frame, options), options.aspect);
}

function assertClose(actual: Rect, expected: Rect, tolerance = 0.5): void {
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= tolerance,
      `${key}: ${actual[key]} != ${expected[key]}`,
    );
  }
}

/** A move or resize at 30 fps from `from` to `to` starting at `start`. */
function drag(from: Rect, to: Rect, start: number, seconds: number): ShownSample[] {
  const frames = Math.round(seconds * 30);
  return Array.from({ length: frames }, (_, index) => {
    const t = (index + 1) / frames;
    return {
      time: start + (index + 1) / 30,
      frame: {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
      },
    };
  });
}

describe("classify", () => {
  test("lone changes and quick blips are instant; per-frame runs are live", () => {
    const samples: ShownSample[] = [
      { time: 0, frame: window },
      { time: 5, frame: withMenu },
      { time: 6, frame: window },
      // A menu flashing open for 75ms.
      { time: 8, frame: withMenu },
      { time: 8.075, frame: window },
      ...drag(window, { ...window, x: 400 }, 10, 1),
    ];
    const { live, instant } = classify(toHolds(samples, 20, area), options);
    assert.deepEqual(instant, [5, 6, 8]);
    assert.equal(live.length, 1);
    assert.ok(Math.abs(live[0]!.start - (10 + 1 / 30)) < 1e-9);
    assert.ok(Math.abs(live[0]!.end - 11) < 1e-9);
  });

  test("bounds are clipped to the recorded area", () => {
    const holds = toHolds(
      [{ time: 0, frame: { x: -100, y: 1000, width: 400, height: 400 } }],
      1,
      area,
    );
    assert.deepEqual(holds[0]!.frame, { x: 0, y: 1000, width: 300, height: 117 });
  });
});

describe("planCamera", () => {
  const samples: ShownSample[] = [
    { time: 0, frame: window },
    { time: 10, frame: withMenu },
    { time: 12, frame: window },
  ];
  const { path } = planCamera(samples, 20, options);

  test("frames the window when nothing is about to change", () => {
    assertClose(cameraAt(path, 5), fitted(window));
    assertClose(cameraAt(path, 18), fitted(window));
  });

  test("makes room for a menu once it opens, not before", () => {
    assertClose(cameraAt(path, 10 - 1 / options.rate), fitted(window));
    // Moving right away, then settled after the transition.
    assert.ok(cameraAt(path, 10 + 0.05).height > fitted(window).height + 1);
    const settled = 10 + options.transition + 1 / options.rate;
    assertClose(cameraAt(path, settled), fitted(withMenu));
    for (let time = settled; time < 12; time += 0.05)
      assert.ok(contains(cameraAt(path, time), withMenu), `at ${time}`);
  });

  test("shrinks right away when the menu closes", () => {
    assertClose(cameraAt(path, 12 - 1 / options.rate), fitted(withMenu));
    assert.ok(cameraAt(path, 12 + 0.05).height < fitted(withMenu).height - 1);
    assertClose(cameraAt(path, 12 + options.transition + 1 / options.rate), fitted(window));
  });

  test("a resize that stays put frames the new bounds right away", () => {
    const smaller: Rect = { ...window, width: 600, height: 400 };
    const { path } = planCamera(
      [
        { time: 0, frame: window },
        { time: 10, frame: smaller },
      ],
      20,
      options,
    );
    assertClose(cameraAt(path, 10 + options.transition + 1 / options.rate), fitted(smaller));
  });

  test("cuts when the followed window switches", () => {
    const other: Rect = { x: 900, y: 300, width: 700, height: 500 };
    const { path, cuts, instant } = planCamera(
      [
        { time: 0, frame: window, window: 1 },
        { time: 10.003, frame: other, window: 2 },
      ],
      20,
      options,
    );
    assert.deepEqual(cuts, [10.003]);
    assert.deepEqual(instant, []);
    assertClose(cameraAt(path, 10.002), fitted(window));
    assertClose(cameraAt(path, 10.003), fitted(other));
  });

  test("cuts at marked samples, without making room across them", () => {
    const { path, cuts } = planCamera(
      [
        { time: 0, frame: window },
        { time: 10, frame: area, cut: true },
      ],
      20,
      options,
    );
    assert.deepEqual(cuts, [10]);
    assertClose(cameraAt(path, 9.99), fitted(window));
    assertClose(cameraAt(path, 10), fitted(area));
  });

  test("stays locked to live motion without anticipating where it ends", () => {
    const moved: Rect = { ...window, x: 600 };
    const resized: Rect = { ...moved, width: 1100, height: 800 };
    const samples = [
      { time: 0, frame: window },
      ...drag(window, moved, 10, 1),
      ...drag(moved, resized, 11.5, 1),
    ];
    const { path, live } = planCamera(samples, 20, options);
    assert.equal(live.length, 2);
    // Before the drag the camera hasn't moved toward the destination.
    assertClose(cameraAt(path, 9.99), fitted(window));
    // During the drag and the resize it frames the window as it is, give or take a frame of motion.
    for (const time of [10.5, 10.8, 12, 12.3]) {
      const shown = samples.findLast((sample) => sample.time <= time)!.frame!;
      const camera = cameraAt(path, time);
      assert.ok(contains(camera, shown), `at ${time}`);
      assert.ok(
        camera.width - fitted(shown).width < 20 && Math.abs(camera.x - fitted(shown).x) < 20,
        `at ${time}`,
      );
    }
    assertClose(cameraAt(path, 15), fitted(resized));
  });

  test("frames the whole area when nothing is shown", () => {
    const { path } = planCamera([{ time: 0 }], 5, options);
    assertClose(cameraAt(path, 1), fitted(area));
  });
});
